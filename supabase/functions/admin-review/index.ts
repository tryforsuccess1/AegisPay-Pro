import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    if (!actor || actor.role !== "MASTER ADMIN" || ["BLOCKED","SUSPENDED","DELETED"].includes(String(actor.status).toUpperCase())) {
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

    if (action === "deposit_manual_shasta") {
      const txid = typeof body?.txid === "string" ? body.txid.trim() : "";
      const senderAddress = typeof body?.senderAddress === "string" ? body.senderAddress.trim() : "";
      const blockTimestampInput = typeof body?.blockTimestamp === "string" ? body.blockTimestamp.trim() : "";
      const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      const confirmations = Number(body?.confirmationBlocks);
      if (!/^[a-fA-F0-9]{64}$/.test(txid)) return json({ error: "Paste the full 64-character TXID verified in the Shasta Explorer." }, 400);
      if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(senderAddress)) return json({ error: "Enter the sender address exactly as shown in the explorer." }, 400);
      if (!Number.isInteger(confirmations) || confirmations < 19) return json({ error: "Manual credit requires at least 19 confirmed blocks; do not approve a pending transaction." }, 400);
      if (reason.length < 20) return json({ error: "Enter an audit reason of at least 20 characters." }, 400);
      if (body?.explorerVerified !== true || body?.amountVerified !== true || body?.recipientVerified !== true || body?.tokenVerified !== true) {
        return json({ error: "Confirm that you checked SUCCESSFUL/CONFIRMED status, exact amount, assigned recipient and pinned Shasta USDT contract in the official explorer." }, 400);
      }
      const blockMillis = Date.parse(blockTimestampInput);
      if (!Number.isFinite(blockMillis) || blockMillis <= 0 || blockMillis > Date.now() + 5 * 60 * 1000) {
        return json({ error: "Enter the confirmed transaction's valid block timestamp in UTC (ISO format)."}, 400);
      }
      const blockTimestamp = new Date(blockMillis).toISOString();

      const { data: deposit, error: depositError } = await admin.from("deposit_submissions")
        .select("id,user_id,status,network,gross_amount,deposit_fee,txid,submitted_txid,token_contract,receiving_address,deposit_wallet_id,screenshot_path,created_at,ai_checks")
        .eq("id", id).maybeSingle();
      if (depositError || !deposit) return json({ error: "Deposit request was not found." }, 404);
      if (deposit.status !== "PENDING_VERIFICATION") return json({ error: "Deposit is no longer awaiting review; no second credit was attempted." }, 409);
      if (String(deposit.network || "").toUpperCase() !== "TRON TESTNET") return json({ error: "Manual override is restricted to Shasta testnet deposits; Mainnet is not supported." }, 403);
      if (!deposit.screenshot_path) return json({ error: "Manual Shasta credit requires uploaded evidence." }, 400);
      if (String(deposit.token_contract || "") !== "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs") return json({ error: "Deposit token is not the pinned Shasta USDT contract." }, 409);
      if (deposit.txid && String(deposit.txid).toLowerCase() !== txid.toLowerCase()) return json({ error: "This request already has a different canonical TXID; reconcile the existing chain match instead of replacing it." }, 409);

      const [{ data: allowlist, error: allowlistError }, { data: wallet, error: walletError }, { data: mainnetRules, error: mainnetRulesError }, { data: shastaRules, error: shastaRulesError }] = await Promise.all([
        admin.from("shasta_test_users").select("user_id,enabled").eq("user_id", deposit.user_id).eq("enabled", true).maybeSingle(),
        admin.from("deposit_wallets").select("id,user_id,address,network,token_contract,status").eq("id", deposit.deposit_wallet_id).eq("user_id", deposit.user_id).maybeSingle(),
        admin.from("platform_settings").select("value_json").eq("key", "deposit_rules").maybeSingle(),
        admin.from("platform_settings").select("value_json").eq("key", "shasta_testnet_rules").maybeSingle(),
      ]);
      if (allowlistError || !allowlist) return json({ error: "Manual credit is limited to an explicitly allowlisted Shasta test user." }, 403);
      if (walletError || !wallet || wallet.address !== deposit.receiving_address
        || String(wallet.network || "").toUpperCase() !== "TRON TESTNET"
        || String(wallet.token_contract || "") !== "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs") {
        return json({ error: "The receiving address does not match the assigned Shasta HD wallet." }, 409);
      }
      if (mainnetRulesError || shastaRulesError || !mainnetRules?.value_json || !shastaRules?.value_json
        || String(mainnetRules.value_json.network || "").toUpperCase() !== "TRON MAINNET"
        || String(mainnetRules.value_json.token_contract || "") !== "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
        || String(shastaRules.value_json.network || "").toUpperCase() !== "TRON TESTNET"
        || String(shastaRules.value_json.token_contract || "") !== "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs") {
        return json({ error: "Manual credit is blocked because network/contract safety settings are invalid." }, 423);
      }

      const timestampWindowStart = new Date(deposit.created_at).getTime() - 30 * 24 * 60 * 60 * 1000;
      if (!Number.isFinite(timestampWindowStart) || blockMillis < timestampWindowStart) {
        return json({ error: "Explorer transaction timestamp is more than 30 days before this request; use a separate reconciliation." }, 400);
      }
      const { data: senderValid, error: senderValidationError } = await admin.rpc("is_valid_tron_address", { p_address: senderAddress });
      if (senderValidationError || senderValid !== true) return json({ error: "Sender address failed TRON Base58Check validation." }, 400);
      const { data: recipientValid, error: recipientValidationError } = await admin.rpc("is_valid_tron_address", { p_address: String(wallet.address) });
      if (recipientValidationError || recipientValid !== true) return json({ error: "Assigned receiving address failed TRON Base58Check validation." }, 409);

      const [canonicalCollision, submittedCollision] = await Promise.all([
        admin.from("deposit_submissions").select("id,status").eq("network", "TRON TESTNET").eq("txid", txid).neq("id", id).limit(1).maybeSingle(),
        admin.from("deposit_submissions").select("id,status").eq("network", "TRON TESTNET").eq("submitted_txid", txid).neq("id", id).limit(1).maybeSingle(),
      ]);
      if (canonicalCollision.error || submittedCollision.error) return json({ error: "Unable to check duplicate transaction claims; manual credit is blocked." }, 503);
      if (canonicalCollision.data || submittedCollision.data) return json({ error: "This TXID is already claimed by another Shasta deposit request. Resolve the duplicate before crediting." }, 409);

      const amountText = String(deposit.gross_amount || "").trim();
      if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(amountText)) return json({ error: "Deposit amount has unsupported precision." }, 409);
      const amountParts = amountText.split(".");
      const rawAmount = (BigInt(amountParts[0]) * 1000000n + BigInt(((amountParts[1] || "") + "000000").slice(0, 6))).toString();
      if (rawAmount === "0") return json({ error: "Deposit amount must be positive." }, 409);

      const reviewEvidence = {
        result: "MASTER_ADMIN_MANUAL_REVIEW",
        reviewed_by: actor.id,
        reviewed_at: new Date().toISOString(),
        explorer: "TRON Shasta Explorer (manual attestation)",
        txid,
        sender_address: senderAddress,
        receiving_address: wallet.address,
        token_contract: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
        raw_amount: rawAmount,
        block_timestamp: blockTimestamp,
        confirmation_blocks: confirmations,
        exact_amount_and_recipient_confirmed: true,
        reason,
      };
      const existingChecks = deposit.ai_checks && typeof deposit.ai_checks === "object" && !Array.isArray(deposit.ai_checks)
        ? deposit.ai_checks as Record<string, unknown> : {};
      const { data: reviewed, error: updateError } = await admin.from("deposit_submissions").update({
        txid,
        ai_review_status: "MANUAL_APPROVED",
        ai_review_reason: "MASTER_ADMIN_MANUAL_SHASTA_APPROVED",
        ai_reviewed_at: new Date().toISOString(),
        ai_policy_version: "MASTER_ADMIN_MANUAL_SHASTA_V1",
        ai_checks: { ...existingChecks, manual_admin_review: reviewEvidence },
        verification_note: "Master Admin manually checked confirmed Shasta explorer evidence. Reason: " + reason,
      }).eq("id", id).eq("status", "PENDING_VERIFICATION").select("id").maybeSingle();
      if (updateError || !reviewed) return json({ error: "Deposit could not be reserved for manual review. Refresh and reconcile before retrying." }, 409);

      await admin.from("audit_events").insert({
        actor_user_id: actor.id, target_user_id: deposit.user_id,
        event_type: "MASTER_ADMIN_MANUAL_SHASTA_CREDIT_ATTEMPT",
        description: "Manual Shasta deposit credit attempted for " + txid + "; confirmed blocks " + confirmations + "; reason: " + reason,
        reference_id: id,
      });

      const { data: applied, error: applyError } = await admin.rpc("apply_verified_deposit", {
        p_deposit_id: id,
        p_sender_address: senderAddress,
        p_raw_amount: rawAmount,
        p_block_timestamp: blockTimestamp,
        p_verification_source: "MASTER_ADMIN_MANUAL_SHASTA_EXPLORER_REVIEW",
      });
      if (applyError) return json({ error: "Manual review was saved, but credit was blocked by the database safety checks: " + applyError.message }, 409);
      await admin.from("audit_events").insert({
        actor_user_id: actor.id, target_user_id: deposit.user_id,
        event_type: "MASTER_ADMIN_MANUAL_SHASTA_CREDITED",
        description: "Master Admin manually credited " + amountText + " Shasta USDT after explorer review. TXID: " + txid + ". Reason: " + reason,
        reference_id: id,
      });
      return json({ status: "VERIFIED", deposit: applied, txid, amount: amountText, manuallyApprovedBy: actor.id });
    }

    if (action === "deposit") {
      const { data: deposit } = await admin.from("deposit_submissions")
        .select("id,status").eq("id", id).maybeSingle();
      if (!deposit || deposit.status !== "PENDING_VERIFICATION") return json({ error: "Deposit is no longer awaiting review." }, 409);
      if (decision === "reject") {
        const { error } = await admin.from("deposit_submissions").update({
          status: "REJECTED", ai_review_status: "REJECTED",
          ai_review_reason: "MASTER_ADMIN_REJECTED",
          verification_note: note || "Evidence rejected during manual review.",
          ai_reviewed_at: new Date().toISOString(),
        }).eq("id", id);
        if (error) return json({ error: "Deposit review could not be saved." }, 500);
        return json({ status: "REJECTED" });
      }
      const { error } = await admin.from("deposit_submissions").update({
        ai_review_status: "MANUAL_APPROVED",
        ai_review_reason: "MASTER_ADMIN_APPROVED",
        verification_note: note || "Evidence approved by Master Admin; on-chain confirmation is still required.",
        ai_reviewed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) return json({ error: "Deposit review could not be saved." }, 500);
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
      const scoped = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: "Bearer " + token } },
      });
      const { data, error } = await scoped.rpc("finalize_withdrawal", {
        p_request_id: id,
        p_approve: decision === "approve",
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

