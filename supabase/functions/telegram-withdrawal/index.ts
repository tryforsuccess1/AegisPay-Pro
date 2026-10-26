import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const CHAT = Deno.env.get("TELEGRAM_CHAT_ID") || "";
const APPROVERS = (Deno.env.get("TELEGRAM_APPROVER_IDS") || "").split(/[\s,]+/).filter((x) => /^[0-9]{1,20}$/.test(x));
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TRON_MAINNET_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const TRON_SHASTA_USDT_CONTRACT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

function client() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Telegram review service is not configured.");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
async function webhookSecret() {
  const raw = new TextEncoder().encode("aegispay-telegram-withdrawal-v1:" + BOT);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  return Array.from(hash).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function telegram(method: string, values: Record<string, unknown> = {}) {
  if (!BOT) throw new Error("Telegram bot token is not configured.");
  const response = await fetch("https://api.telegram.org/bot" + BOT + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error("Telegram " + method + " request failed.");
  return body.result;
}
async function ensureWebhook() {
  if (!CHAT || !APPROVERS.length) throw new Error("Telegram chat and authorized approver IDs are not configured.");
  const endpoint = SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/telegram-withdrawal";
  const current = await telegram("getWebhookInfo");
  if (current?.url && current.url !== endpoint) throw new Error("The Telegram bot already uses a different webhook URL.");
  await telegram("setWebhook", {
    url: endpoint,
    secret_token: await webhookSecret(),
    allowed_updates: ["callback_query"],
    drop_pending_updates: false,
  });
  return { endpoint, pendingUpdates: Number(current?.pending_update_count || 0) };
}
async function isRunning(admin: ReturnType<typeof client>) {
  const { data, error } = await admin.rpc("app_runtime_enabled");
  if (error) throw new Error("Unable to confirm AegisPay runtime status.");
  return data === true;
}

/**
 * A profile-wallet mismatch is allowed only for an explicitly allowlisted, exact
 * Shasta test recipient while every live-money/production gate stays locked.
 * This is a review-message exception only; it never changes the user's profile.
 */
async function isExplicitlyAllowlistedShastaDestination(
  admin: ReturnType<typeof client>,
  withdrawalId: string,
  userId: string,
  destinationAddress: string,
): Promise<boolean> {
  if (
    Deno.env.get("TRON_SHASTA_TEST_PAYOUTS_ENABLED") !== "true" ||
    !validUuid(withdrawalId) ||
    !validUuid(userId) ||
    !TRON_ADDRESS_RE.test(destinationAddress)
  ) return false;

  const [
    { data: withdrawalPermit, error: withdrawalPermitError },
    { data: userPermit, error: userPermitError },
    { data: shastaRow, error: shastaError },
    { data: modeRow, error: modeError },
    { data: productionRow, error: productionError },
    { data: mainnetRow, error: mainnetError },
  ] = await Promise.all([
    admin.from("shasta_test_withdrawals")
      .select("withdrawal_id,destination_address")
      .eq("withdrawal_id", withdrawalId)
      .eq("enabled", true)
      .maybeSingle(),
    admin.from("shasta_test_users")
      .select("user_id")
      .eq("user_id", userId)
      .eq("enabled", true)
      .maybeSingle(),
    admin.from("platform_settings").select("value_json").eq("key", "shasta_testnet_rules").maybeSingle(),
    admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle(),
    admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle(),
    admin.from("platform_settings").select("value_json").eq("key", "deposit_rules").maybeSingle(),
  ]);

  if (
    withdrawalPermitError || userPermitError || shastaError || modeError || productionError || mainnetError ||
    !withdrawalPermit || !userPermit || !shastaRow?.value_json || !modeRow?.value_json ||
    !productionRow?.value_json || !mainnetRow?.value_json
  ) return false;

  // Recipient matching is exact and case-sensitive because TRON addresses are case-sensitive.
  if (String(withdrawalPermit.destination_address || "") !== destinationAddress) return false;

  const shasta = shastaRow.value_json;
  const mode = modeRow.value_json;
  const production = productionRow.value_json;
  const mainnet = mainnetRow.value_json;
  const validShastaRules =
    String(shasta.network || "").toUpperCase() === "TRON TESTNET" &&
    String(shasta.token_contract || "").trim() === TRON_SHASTA_USDT_CONTRACT &&
    TRON_ADDRESS_RE.test(String(shasta.receiving_address || ""));
  const paymentGatesClosed =
    String(mode.mode || "").toUpperCase() === "MAINNET" &&
    mode.real_payouts === false &&
    mode.live_deposits === false &&
    mode.production_go_live_approved === false &&
    String(production.environment || "").toUpperCase() === "PRE_PRODUCTION" &&
    production.payouts_locked === true &&
    production.real_payouts_enabled === false &&
    production.live_deposits_enabled === false &&
    production.go_live_approved === false;
  const separateMainnetRules =
    String(mainnet.network || "").toUpperCase() === "TRON MAINNET" &&
    String(mainnet.token_contract || "").trim() === TRON_MAINNET_USDT_CONTRACT &&
    TRON_ADDRESS_RE.test(String(mainnet.receiving_address || "")) &&
    String(mainnet.receiving_address || "").trim() !== String(shasta.receiving_address || "").trim();

  return validShastaRules && paymentGatesClosed && separateMainnetRules;
}
async function authenticatedActor(req: Request, admin: ReturnType<typeof client>) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Response("Authorization required.", { status: 401 });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Response("Invalid authentication token.", { status: 401 });
  const { data: profile, error: profileError } = await admin.from("users")
    .select("id,role,status,name,email").eq("auth_user_id", data.user.id).maybeSingle();
  if (profileError || !profile) throw new Response("AegisPay profile not found.", { status: 404 });
  if (!["ACTIVE", "NORMAL"].includes(String(profile.status || "").toUpperCase())) {
    throw new Response("Active account access is required.", { status: 403 });
  }
  return { user: data.user, profile };
}
async function checkWebhook(req: Request) {
  if (!BOT || !SUPABASE_URL || !SERVICE_KEY) return json({ error: "Telegram webhook is not configured." }, 503);
  const supplied = req.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!supplied || supplied !== await webhookSecret()) return json({ error: "Unauthorized webhook." }, 401);
  const admin = client();
  let update: any;
  try { update = await req.json(); } catch { return json({ ok: true }); }
  const query = update?.callback_query;
  if (!query) return json({ ok: true });
  const answer = (text: string) => telegram("answerCallbackQuery", {
    callback_query_id: query.id, text: text.slice(0, 180), show_alert: false,
  }).catch(() => null);
  if (!CHAT || !APPROVERS.includes(String(query.from?.id || ""))) {
    await answer("This Telegram account is not an authorized approver.");
    return json({ ok: true });
  }
  const message = query.message;
  if (!message || String(message.chat?.id || "") !== CHAT) {
    await answer("This approval message is outside the configured review chat.");
    return json({ ok: true });
  }
  const match = /^wd:([0-9a-f-]{36}):(a|r)$/i.exec(String(query.data || ""));
  if (!match || !validUuid(match[1])) {
    await answer("This approval button is invalid.");
    return json({ ok: true });
  }
  const { data: withdrawal } = await admin.from("withdrawal_requests")
    .select("id,status,telegram_message_id").eq("id", match[1]).maybeSingle();
  if (!withdrawal || String(withdrawal.telegram_message_id || "") !== String(message.message_id)) {
    await answer("This approval message is no longer valid.");
    return json({ ok: true });
  }
  if (!await isRunning(admin)) {
    await answer("AegisPay is paused. No approval was recorded.");
    return json({ ok: true });
  }
  const { data, error } = await admin.rpc("record_withdrawal_telegram_decision", {
    p_request_id: match[1], p_approve: match[2] === "a", p_telegram_user_id: String(query.from.id),
  });
  if (error || !data) {
    await answer("This withdrawal was already reviewed or is no longer awaiting Telegram approval.");
    return json({ ok: true });
  }
  const approved = match[2] === "a";
  const bothApproved = data.status === "APPROVED" && data.panel_decision === "APPROVED" && data.telegram_decision === "APPROVED";
  await answer(approved ? (bothApproved ? "Telegram approved. Both approvals are complete." : "Telegram approved. Waiting for Master Admin approval.") : "Withdrawal rejected.");
  await telegram("editMessageReplyMarkup", {
    chat_id: CHAT, message_id: message.message_id, reply_markup: { inline_keyboard: [] },
  }).catch(() => null);
  await telegram("sendMessage", {
    chat_id: CHAT,
    text: "Withdrawal " + (approved ? "approved" : "rejected") + " in Telegram. Request " + match[1] + (bothApproved ? " has both approvals and is ready for the Master Admin payout step." : " status: " + data.status + "."),
  }).catch(() => null);
  return json({ ok: true });
}
async function sendWithdrawal(admin: ReturnType<typeof client>, withdrawalId: string) {
  await ensureWebhook();
  const { data: w, error: withdrawalError } = await admin.from("withdrawal_requests")
    .select("id,user_id,amount,fee_amount,net_amount,destination_address,status,panel_decision,telegram_decision")
    .eq("id", withdrawalId).maybeSingle();
  if (withdrawalError || !w) throw new Error("Withdrawal not found.");
  if (!["PENDING_APPROVAL", "APPROVED"].includes(w.status) || w.telegram_decision !== "PENDING") {
    throw new Error("This withdrawal is no longer awaiting Telegram approval.");
  }
  const { data: u } = await admin.from("users")
    .select("name,email,status,current_platform_balance,withdrawal_held,destination_address")
    .eq("id", w.user_id).maybeSingle();
  const { data: kyc } = await admin.from("kyc_verifications")
    .select("status").eq("user_id", w.user_id).eq("status", "VERIFIED").limit(1).maybeSingle();
  if (!u || !["ACTIVE","NORMAL"].includes(String(u.status || "").toUpperCase())) {
    throw new Error("Client account is not active.");
  }
  let isolatedShastaDestination = false;
  if (!u.destination_address || String(u.destination_address) !== String(w.destination_address)) {
    isolatedShastaDestination = await isExplicitlyAllowlistedShastaDestination(
      admin,
      String(w.id || withdrawalId),
      String(w.user_id || ""),
      String(w.destination_address || ""),
    );
    if (!isolatedShastaDestination) throw new Error("Withdrawal wallet validation failed.");
  }
  if (!kyc) throw new Error("KYC is not verified.");
  if (!Number.isFinite(Number(w.amount)) || Number(w.amount) <= 0) {
    throw new Error("Withdrawal amount validation failed.");
  }
  const text = "AegisPay withdrawal approval\n\nRequest: " + w.id +
    "\nClient: " + String(u?.name || "Unknown client").slice(0, 120) +
    "\nAmount: " + Number(w.amount).toFixed(2) + " USDT" +
    "\nFee: " + Number(w.fee_amount).toFixed(2) + " USDT" +
    "\nNet payout: " + Number(w.net_amount).toFixed(2) + " USDT" +
    "\nTRON wallet: " + String(w.destination_address).slice(0, 60) +
    "\nNetwork scope: " + (isolatedShastaDestination ? "ISOLATED TRON SHASTA TESTNET ONLY" : "standard approved withdrawal") +
    "\nValidation: PASSED" +
    (isolatedShastaDestination ? " (exact test recipient is allowlisted)" : "") +
    "\nMaster Admin: " + String(w.panel_decision || "PENDING");
  const sent = await telegram("sendMessage", {
    chat_id: CHAT, text,
    reply_markup: { inline_keyboard: [[
      { text: "Approve", callback_data: "wd:" + w.id + ":a" },
      { text: "Reject", callback_data: "wd:" + w.id + ":r" },
    ]] },
  });
  const { error } = await admin.from("withdrawal_requests").update({
    telegram_status: "SENT", telegram_message_id: String(sent?.message_id || ""),
  }).eq("id", w.id).eq("telegram_decision", "PENDING");
  if (error || !sent?.message_id) throw new Error("Telegram sent the message but its review reference could not be saved.");
  return { sent: true, messageId: sent.message_id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (req.headers.has("X-Telegram-Bot-Api-Secret-Token")) return await checkWebhook(req);
  try {
    const admin = client();
    const { profile, user } = await authenticatedActor(req, admin);
    if (!await isRunning(admin)) return json({ error: "AegisPay is paused by Master Admin." }, 423);
    const body = await req.json().catch(() => null);
    const action = String(body?.action || "notify");
    if (action === "diagnostics") {
      if (profile.role !== "MASTER ADMIN") return json({ error: "Master Admin access required." }, 403);
      if (!BOT || !CHAT || !APPROVERS.length) return json({
        configured: false, tokenConfigured: Boolean(BOT), chatConfigured: Boolean(CHAT),
        approversConfigured: APPROVERS.length > 0, webhookReady: false,
      }, 200);
      const [bot, chat] = await Promise.all([telegram("getMe"), telegram("getChat", { chat_id: CHAT })]);
      const webhook = await ensureWebhook();
      return json({
        configured: true, tokenConfigured: true, chatConfigured: true,
        approversConfigured: true, approverCount: APPROVERS.length,
        botUsername: bot?.username || null, chatTitle: chat?.title || chat?.username || chat?.first_name || null,
        chatType: chat?.type || null, webhookReady: true, pendingUpdates: webhook.pendingUpdates,
      });
    }
    if (action !== "notify" && action !== "resend") return json({ error: "Unsupported Telegram action." }, 400);
    const withdrawalId = body?.withdrawalId;
    if (!validUuid(withdrawalId)) return json({ error: "A valid withdrawal is required." }, 400);
    if (action === "resend") {
      if (profile.role !== "MASTER ADMIN") return json({ error: "Master Admin access required." }, 403);
    } else {
      if (profile.role !== "USER") return json({ error: "Client account access required." }, 403);
      const { data: withdrawal } = await admin.from("withdrawal_requests").select("id")
        .eq("id", withdrawalId).eq("user_id", profile.id).maybeSingle();
      if (!withdrawal) return json({ error: "Withdrawal not found for this account." }, 404);
    }
    try {
      return json(await sendWithdrawal(admin, withdrawalId));
    } catch (error) {
      await admin.from("withdrawal_requests").update({ telegram_status: "FAILED" })
        .eq("id", withdrawalId).eq("telegram_decision", "PENDING");
      throw error;
    }
  } catch (error) {
    if (error instanceof Response) return json({ error: await error.text() }, error.status);
    return json({ error: (error as Error)?.message || "Telegram operation failed." }, 503);
  }
});

