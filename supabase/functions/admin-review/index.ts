import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isActiveMasterAdmin } from "./active-master-admin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Admin review service is not configured." }, 503);
  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authorization required." }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid authentication token." }, 401);
    const { data: actor } = await admin.from("users").select("id,role,status")
      .eq("auth_user_id", auth.user.id).maybeSingle();
    if (!isActiveMasterAdmin(actor)) {
      return json({ error: "Master Admin access required." }, 403);
    }
    // Internal Master Admin review remains available even when client operations are paused.
    // Pausing the platform must not block queued verification decisions.
    const body = await req.json().catch(() => null);
    const action = String(body?.action || "");
    const decision = String(body?.decision || "");
    const id = String(body?.id || "");
    const note = String(body?.note || "").trim().slice(0, 500);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return json({ error: "A valid review item is required." }, 400);
    }

    if (!["approve","reject"].includes(decision)) return json({ error: "Choose approve or reject." }, 400);

    if (action === "deposit") {
      const { data: deposit, error: lookupError } = await admin.from("deposit_submissions")
        .select("id,status,txid,submitted_txid,network,screenshot_path")
        .eq("id", id).maybeSingle();
      if (lookupError) return json({ error: "Unable to load the pending deposit." }, 500);
      if (!deposit || deposit.status !== "PENDING_VERIFICATION") return json({ error: "Deposit is no longer awaiting review." }, 409);
      if (decision === "reject") {
        const { error } = await admin.from("deposit_submissions").update({
          status: "REJECTED", ai_review_status: "REJECTED",
          ai_review_reason: "MASTER_ADMIN_REJECTED",
          verification_note: note || "Deposit rejected by Master Admin.",
          ai_reviewed_at: new Date().toISOString(),
        }).eq("id", id);
        if (error) return json({ error: "Deposit rejection could not be saved." }, 500);
        return json({ status: "REJECTED" });
      }

      // Simple one-click Master Admin approval is supported for the allowlisted
      // Shasta TESTNET path only when no transaction hash was supplied. The
      // database routine locks the deposit and records a test-only credit with
      // an audit trail, while enforcing all live-money gates remain closed.
      // MAINNET credits still require confirmed on-chain verification.
      const network = String(deposit.network || "").trim().toUpperCase();
      const hasTxid = Boolean(String(deposit.txid || "").trim() || String(deposit.submitted_txid || "").trim());
      if (network === "TRON TESTNET" && !hasTxid) {
        if (!deposit.screenshot_path) return json({ error: "Deposit evidence is required before approval." }, 409);
        const { data: credited, error: creditError } = await admin.rpc("apply_manual_testnet_deposit_approval", {
          p_deposit_id: id,
          p_actor_user_id: actor.id,
        });
        if (creditError) {
          return json({ error: creditError.message || "Testnet deposit could not be approved." }, 409);
        }
        const creditedRow = Array.isArray(credited) ? credited[0] : credited;
        if (!creditedRow || creditedRow.status !== "VERIFIED") {
          return json({ error: "Testnet approval did not reach the verified state." }, 409);
        }
        return json({ status: "VERIFIED", manualTestnetApproval: true, requiresChainVerification: false });
      }

      const { error } = await admin.from("deposit_submissions").update({
        ai_review_status: "MANUAL_APPROVED",
        ai_review_reason: "MASTER_ADMIN_APPROVED",
        verification_note: note || "Evidence approved by Master Admin; confirmed on-chain transfer verification is still required.",
        ai_reviewed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) return json({ error: "Deposit approval could not be saved." }, 500);
      return json({ status: "PENDING_VERIFICATION", requiresChainVerification: true });
    }

    if (action === "kyc") {
      const { data: kyc } = await admin.from("kyc_verifications")
        .select("id,user_id,status").eq("id", id).maybeSingle();
      if (!kyc || !["PENDING_REVIEW","MANUAL_REVIEW"].includes(kyc.status)) {
        return json({ error: "KYC item is no longer awaiting review." }, 409);
      }
      if (decision === "approve") {
        const { data: prior } = await admin.from("kyc_verifications")
          .select("id").eq("user_id", kyc.user_id).eq("status", "VERIFIED").limit(1).maybeSingle();
        if (prior) return json({ error: "This account already has verified KYC." }, 409);
      }
      const status = decision === "approve" ? "VERIFIED" : "REJECTED";
      const { error } = await admin.from("kyc_verifications").update({
        status,
        ai_review_status: decision === "approve" ? "MANUAL_APPROVED" : "REJECTED",
        review_reason: decision === "approve" ? (note || "MASTER_ADMIN_APPROVED") : (note || "MASTER_ADMIN_REJECTED"),
        reviewed_at: new Date().toISOString(),
        reviewed_by: actor.id,
      }).eq("id", id);
      if (error) return json({ error: "KYC review could not be saved." }, 500);
      return json({ status });
    }

    if (action === "withdrawal") {
      // The caller JWT was verified above and mapped to an active Master Admin.
      // Keep this privileged mutation behind the service-role-only RPC.
      const { data, error } = await admin.rpc("finalize_withdrawal_as_admin", {
        p_request_id: id,
        p_approve: decision === "approve",
        p_actor_user_id: actor.id,
      });
      if (error) return json({ error: error.message || "Withdrawal review failed." }, 400);
      return json({
        status: data?.status || (decision === "approve" ? "PENDING_APPROVAL" : "REJECTED"),
        panelDecision: data?.panel_decision || (decision === "approve" ? "APPROVED" : "REJECTED"),
        telegramDecision: data?.telegram_decision || "PENDING",
        requiresTelegramApproval: data?.status === "PENDING_APPROVAL" && decision === "approve",
      });
    }

    return json({ error: "Unsupported review type." }, 400);
  } catch {
    return json({ error: "Review action could not be completed." }, 500);
  }
});

