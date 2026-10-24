import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MAINNET_PAYOUT_KEY = Deno.env.get("TRON_MAINNET_TREASURY_PRIVATE_KEY") || "";
const TESTNET_PAYOUT_KEY = Deno.env.get("TRON_SHASTA_TREASURY_PRIVATE_KEY") || "";
const TRONGRID_KEY = Deno.env.get("TRONGRID_API_KEY") || "";
const MAINNET_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SHASTA_USDT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const validUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function getActor(req: Request, admin: ReturnType<typeof createClient<any>>) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Response("Authorization required.", { status: 401 });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Response("Invalid authentication token.", { status: 401 });
  const { data: profile, error: pError } = await admin.from("users")
    .select("id,role,status,name,email,auth_user_id")
    .eq("auth_user_id", data.user.id).maybeSingle();
  if (pError || !profile) throw new Response("AegisPay profile not found.", { status: 404 });
  if (["BLOCKED", "SUSPENDED", "DELETED"].includes(String(profile.status || "").toUpperCase())) {
    throw new Response("This account is not active.", { status: 403 });
  }
  return { user: data.user, profile };
}
async function setting(admin: ReturnType<typeof createClient<any>>, key: string) {
  const { data, error } = await admin.from("platform_settings").select("value_json").eq("key", key).maybeSingle();
  if (error) throw new Error("Unable to read the " + key + " setting.");
  return data?.value_json || {};
}
async function recordDecision(admin: ReturnType<typeof createClient<any>>, requestId: string, decision: string, confidence: number | null, reason: string) {
  const { error } = await admin.from("withdrawal_requests").update({
    ai_decision: decision,
    ai_confidence: confidence,
    ai_review_reason: reason.slice(0, 500),
    ai_reviewed_at: new Date().toISOString(),
  }).eq("id", requestId).eq("status", "PENDING_APPROVAL").eq("panel_decision", "PENDING");
  if (error) throw new Error("The AI review decision could not be saved.");
}
async function payoutGateReady(admin: ReturnType<typeof createClient<any>>) {
  const [mode, deposit, production, runtime] = await Promise.all([
    setting(admin, "system_mode"), setting(admin, "deposit_rules"), setting(admin, "production_config"),
    admin.rpc("app_runtime_enabled"),
  ]);
  if (runtime.error || runtime.data !== true) return { ready: false, reason: "PAYOUT_GATE_LOCKED: platform runtime is paused." };
  const network = String(deposit.network || "").toUpperCase();
  const testnet = String(mode.mode || "").toUpperCase() === "TESTNET_DEMO"
    && mode.testnet_payouts === true && network === "TRON TESTNET"
    && String(deposit.token_contract || "") === SHASTA_USDT
    && Boolean(TESTNET_PAYOUT_KEY) && Boolean(TRONGRID_KEY);
  const mainnet = String(mode.mode || "").toUpperCase() === "MAINNET"
    && mode.real_payouts === true && mode.production_go_live_approved === true
    && network === "TRON MAINNET"
    && production.go_live_approved === true && production.real_payouts_enabled === true
    && production.payouts_locked === false && String(production.environment || "").toUpperCase() === "PRODUCTION"
    && Boolean(MAINNET_PAYOUT_KEY) && Boolean(TRONGRID_KEY)
    && (!deposit.token_contract || String(deposit.token_contract) === MAINNET_USDT);
  if (!testnet && !mainnet) return { ready: false, reason: "PAYOUT_GATE_LOCKED: Phase 3 payout configuration or required payout credentials are not ready." };
  return { ready: true, reason: "" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Withdrawal AI service is not configured." }, 503);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { user, profile } = await getActor(req, admin);
    const body = await req.json().catch(() => null);
    const action = String(body?.action || "review");

    if (action === "settings") {
      if (profile.role !== "MASTER ADMIN" || !["ACTIVE", "NORMAL"].includes(String(profile.status || "").toUpperCase())) {
        return json({ error: "Active Master Admin access required." }, 403);
      }
      const current = await setting(admin, "withdrawal_ai");
      const next = {
        ...current,
        enabled: false,
        policy_version: "2026-10-20-manual-admin-review-only",
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      };
      const { error } = await admin.from("platform_settings").upsert({
        key: "withdrawal_ai", value_json: next, updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      if (error) return json({ error: "Withdrawal settings could not be saved." }, 500);
      await admin.from("audit_events").insert({
        actor_user_id: profile.id,
        event_type: "WITHDRAWAL_AI_MANUAL_REVIEW_ENFORCED",
        description: "Withdrawal AI auto-approval remains disabled by policy. All requests require Master Admin review.",
      });
      return json({ ok: true, settings: next, policy: "MANUAL_ADMIN_REVIEW_ONLY" });
    }

    if (action !== "review") return json({ error: "Unsupported withdrawal review action." }, 400);
    if (profile.role !== "USER") return json({ error: "Client account access is required to submit a withdrawal for review." }, 403);
    const requestId = body?.withdrawalId;
    if (!validUuid(requestId)) return json({ error: "A valid withdrawalId is required." }, 400);

        const { data: w, error: wError } = await admin.from("withdrawal_requests")
      .select("id,user_id,amount,destination_address,status,panel_decision")
      .eq("id", requestId).eq("user_id", profile.id).maybeSingle();
    if (wError || !w) return json({ error: "Withdrawal request was not found for this account." }, 404);
    if (w.status !== "PENDING_APPROVAL" || w.panel_decision !== "PENDING") {
      return json({
        status: w.status,
        decision: "MANUAL_REVIEW_ONLY",
        alreadyReviewed: true,
        requiresManualReview: w.status === "PENDING_APPROVAL"
      });
    }

    const reason = "Withdrawal requests are routed to the Master Admin review queue by policy. The assistant does not evaluate or approve withdrawal requests, and no payout was initiated.";
    await recordDecision(admin, requestId, "MANUAL_REVIEW", null, reason);
    await admin.from("audit_events").insert({
      actor_user_id: null,
      target_user_id: profile.id,
      event_type: "WITHDRAWAL_AI_ESCALATED",
      description: "Withdrawal request routed to Master Admin review under manual-only policy. No automatic approval or payout was attempted.",
      reference_id: requestId,
    });
    return json({
      status: "PENDING_APPROVAL",
      decision: "MANUAL_REVIEW",
      confidence: null,
      requiresManualReview: true,
      reason,
      notifyAdmin: true,
      payoutSent: false,
    });
  } catch (error) {
    if (error instanceof Response) return json({ error: await error.text() }, error.status);
    return json({ error: (error as Error)?.message || "Withdrawal AI review failed." }, 503);
  }
});
