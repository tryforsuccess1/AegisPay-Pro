import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MAINNET_PAYOUT_KEY = Deno.env.get("TRON_PAYOUT_PRIVATE_KEY") || "";
const TESTNET_PAYOUT_KEY = Deno.env.get("TRON_TESTNET_PAYOUT_PRIVATE_KEY") || "";
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

async function getActor(req: Request, admin: ReturnType<typeof createClient>) {
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
async function setting(admin: ReturnType<typeof createClient>, key: string) {
  const { data, error } = await admin.from("platform_settings").select("value_json").eq("key", key).maybeSingle();
  if (error) throw new Error("Unable to read the " + key + " setting.");
  return data?.value_json || {};
}
async function recordDecision(admin: ReturnType<typeof createClient>, requestId: string, decision: string, confidence: number | null, reason: string) {
  const { error } = await admin.from("withdrawal_requests").update({
    ai_decision: decision,
    ai_confidence: confidence,
    ai_review_reason: reason.slice(0, 500),
    ai_reviewed_at: new Date().toISOString(),
  }).eq("id", requestId).eq("status", "PENDING_APPROVAL").eq("panel_decision", "PENDING");
  if (error) throw new Error("The AI review decision could not be saved.");
}
async function payoutGateReady(admin: ReturnType<typeof createClient>) {
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
      if (typeof body?.enabled !== "boolean") return json({ error: "Choose ON or OFF for the withdrawal AI bot." }, 400);
      const requestedLimit = Number(body?.maxAutoApproveUsdt ?? 100);
      if (!Number.isFinite(requestedLimit) || requestedLimit < 50 || requestedLimit > 500) {
        return json({ error: "Auto-approval limit must be between 50 and 500 USDT." }, 400);
      }
      const current = await setting(admin, "withdrawal_ai");
      const next = {
        enabled: body.enabled,
        max_auto_approve_usdt: Math.round(requestedLimit * 100) / 100,
        min_confidence: 0.98,
        max_risk_score: 0.10,
        policy_version: "2026-10-11-v1",
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      };
      const { error } = await admin.from("platform_settings").upsert({
        key: "withdrawal_ai", value_json: next, updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      if (error) return json({ error: "Withdrawal AI settings could not be saved." }, 500);
      await admin.from("audit_events").insert({
        actor_user_id: profile.id,
        event_type: "WITHDRAWAL_AI_SETTINGS_UPDATED",
        description: "Withdrawal AI approval bot set to " + (next.enabled ? "ON" : "OFF") +
          "; auto-approval ceiling " + next.max_auto_approve_usdt.toFixed(2) + " USDT.",
      });
      return json({ ok: true, settings: next, previousEnabled: current.enabled === true });
    }

    if (action !== "review") return json({ error: "Unsupported withdrawal AI action." }, 400);
    if (profile.role !== "USER") return json({ error: "Client account access is required for automatic withdrawal review." }, 403);
    const requestId = body?.withdrawalId;
    if (!validUuid(requestId)) return json({ error: "A valid withdrawalId is required." }, 400);

    const { data: w, error: wError } = await admin.from("withdrawal_requests")
      .select("id,user_id,amount,destination_address,ai_risk_score,status,panel_decision,ai_decision,created_at")
      .eq("id", requestId).eq("user_id", profile.id).maybeSingle();
    if (wError || !w) return json({ error: "Withdrawal request was not found for this account." }, 404);
    if (w.status !== "PENDING_APPROVAL" || w.panel_decision !== "PENDING") {
      return json({ status: w.status, decision: w.ai_decision || "PENDING_REVIEW", alreadyReviewed: true, requiresManualReview: w.status === "PENDING_APPROVAL" });
    }

    const config = await setting(admin, "withdrawal_ai");
    if (config.enabled !== true) {
      await recordDecision(admin, requestId, "BOT_OFF", null, "Withdrawal AI bot is OFF. Request remains in the Master Admin review queue.");
      return json({ status: "PENDING_APPROVAL", decision: "BOT_OFF", requiresManualReview: true, reason: "Withdrawal AI bot is OFF." });
    }

    const maxAmount = Math.min(500, Math.max(50, Number(config.max_auto_approve_usdt || 100)));
    const maxRisk = Math.min(0.10, Math.max(0, Number(config.max_risk_score ?? 0.10)));
    const [uResult, kycResult, recentResult] = await Promise.all([
      admin.from("users").select("id,role,status,destination_address,current_platform_balance,withdrawal_held,created_at")
        .eq("id", profile.id).maybeSingle(),
      admin.from("kyc_verifications").select("status,submitted_at").eq("user_id", profile.id)
        .order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("withdrawal_requests").select("id,status,created_at").eq("user_id", profile.id)
        .neq("id", requestId).gt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .in("status", ["PENDING_APPROVAL", "APPROVED", "PROCESSING", "PAID", "FAILED"]).limit(1),
    ]);
    const u = uResult.data;
    const kyc = kycResult.data;
    const recent = recentResult.data || [];
    const checks: Array<{ ok: boolean; label: string }> = [
      { ok: Boolean(u && u.role === "USER" && ["ACTIVE", "NORMAL"].includes(String(u.status || "").toUpperCase()), label: "User account is active" },
      { ok: Boolean(kyc && kyc.status === "VERIFIED"), label: "Latest KYC is verified" },
      { ok: Boolean(u && String(u.destination_address || "").trim() && String(w.destination_address || "").trim() === String(u.destination_address || "").trim()), label: "Withdrawal destination matches the locked wallet" },
      { ok: Number(w.amount) >= 50 && Number(w.amount) <= maxAmount, label: "Amount is within the configured auto-approval limit" },
      { ok: Number(w.ai_risk_score) <= maxRisk, label: "Stored risk score is below the policy ceiling" },
      { ok: Boolean(u && Number(u.current_platform_balance || 0) >= Number(w.amount) && Number(u.withdrawal_held || 0) >= Number(w.amount)), label: "Balance and withdrawal hold reconcile" },
      { ok: recent.length === 0, label: "No other withdrawal activity in the last 24 hours" },
    ];
    const passed = checks.filter((x) => x.ok).length;
    const confidence = Number((0.55 + (0.44 * passed / checks.length)).toFixed(4));
    const failures = checks.filter((x) => !x.ok).map((x) => x.label);
    if (uResult.error || kycResult.error || recentResult.error) failures.push("Required risk-check data could not be verified");

    if (failures.length === 0) {
      const gate = await payoutGateReady(admin);
      if (gate.ready) {
        const reason = "High-confidence policy passed: verified KYC, active account, locked-wallet match, amount ceiling, low recorded risk, reconciled balance/hold and no recent withdrawal.";
        const { data: approved, error: approveError } = await admin.rpc("auto_approve_withdrawal", {
          p_request_id: requestId, p_confidence: Math.max(confidence, 0.99), p_reason: reason,
        });
        if (!approveError && approved?.decision === "AUTO_APPROVED" && approved?.status === "APPROVED") {
          await admin.from("notifications").insert({
            user_id: profile.id, notification_type: "withdrawal_ai",
            title: "Withdrawal approved", body: "The eligibility bot approved your withdrawal request. Transfer processing remains subject to platform payout controls.",
          });
          return json({ status: "APPROVED", decision: "AUTO_APPROVED", confidence: Math.max(confidence, 0.99), requiresManualReview: false, payoutSent: false });
        }
        failures.push(approveError?.message || approved?.reason || "Database policy did not permit automatic approval");
      } else {
        failures.push(gate.reason);
      }
    }

    const reason = failures.join("; ").slice(0, 500);
    const decision = failures.some((x) => x.includes("PAYOUT_GATE_LOCKED") || x.includes("platform runtime")) ? "GATE_LOCKED" : "MANUAL_REVIEW";
    await recordDecision(admin, requestId, decision, confidence, reason);
    await admin.from("audit_events").insert({
      actor_user_id: null, target_user_id: profile.id, event_type: "WITHDRAWAL_AI_ESCALATED",
      description: "Withdrawal was routed to Master Admin review. Confidence=" + confidence.toFixed(4) + "; reason=" + reason,
      reference_id: requestId,
    });
    return json({
      status: "PENDING_APPROVAL", decision, confidence, requiresManualReview: true, reason,
      notifyAdmin: true,
    });
  } catch (error) {
    if (error instanceof Response) return json({ error: await error.text() }, error.status);
    return json({ error: (error as Error)?.message || "Withdrawal AI review failed." }, 503);
  }
});
