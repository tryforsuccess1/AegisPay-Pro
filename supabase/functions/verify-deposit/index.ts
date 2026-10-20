import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  exactUsdtRawAmountMatches,
  findExactShastaUsdtTransfer,
  findShastaTransfersByAmount,
  isValidTronTxid,
  TRON_SHASTA_USDT_CONTRACT,
} from "../_shared/tron-deposit-validation.ts";
import { isAllowlistedShastaTestUser, loadShastaTestRules } from "../_shared/shasta-test-mode.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const TRONGRID_KEY = Deno.env.get("TRONGRID_API_KEY");
const CRON_SECRET = Deno.env.get("AEGIS_CRON_SECRET");
const MAINNET_PAYOUT_KEY = Deno.env.get("TRON_PAYOUT_PRIVATE_KEY");
const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
const TELEGRAM_APPROVER_IDS = (Deno.env.get("TELEGRAM_APPROVER_IDS") || "").split(/[\s,]+/).filter((x) => /^[0-9]{1,20}$/.test(x));
const MAINNET_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SHASTA_TEST_USDT = TRON_SHASTA_USDT_CONTRACT;
const SHASTA_TEST_MODE_ENABLED = Deno.env.get("AEGIS_SHASTA_TEST_MODE") === "true";
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
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Deposit service is not configured." }, 503);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authorization required." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid authentication token." }, 401);
    const { data: appEnabled, error: runtimeError } = await admin.rpc("app_runtime_enabled");
    if (runtimeError) return json({ error: "Unable to confirm AegisPay runtime status." }, 503);
    if (appEnabled !== true) return json({ error: "AegisPay is paused by Master Admin." }, 423);
    const { data: profile } = await admin.from("users")
      .select("id,auth_user_id,role,status").eq("auth_user_id", auth.user.id).maybeSingle();
    if (!profile || !["USER","MASTER ADMIN"].includes(profile.role)) return json({ error: "AegisPay profile not found." }, 404);
    if (["BLOCKED","SUSPENDED","DELETED"].includes(String(profile.status).toUpperCase())) {
      return json({ error: "This account cannot verify deposits." }, 403);
    }

    const body = await req.json().catch(() => null);
    const depositId = typeof body?.depositId === "string" ? body.depositId : "";
    if (!depositId) return json({ error: "depositId is required." }, 400);
    let depositQuery = admin.from("deposit_submissions").select("*").eq("id", depositId);
    if (profile.role !== "MASTER ADMIN") depositQuery = depositQuery.eq("user_id", profile.id);
    const { data: deposit, error: depError } = await depositQuery.maybeSingle();
    if (depError || !deposit) return json({ error: "Deposit not found." }, 404);
    if (deposit.status !== "PENDING_VERIFICATION") return json({ status: deposit.status });

    const depositNetwork = String(deposit.network || "").toUpperCase();
    // The allowlist is checked against the deposit owner (not the caller profile,
    // so an authorized Master Admin can investigate the same isolated test row).
    const isShastaTestUser = depositNetwork === "TRON TESTNET"
      ? await isAllowlistedShastaTestUser(admin, String(deposit.user_id || ""), SHASTA_TEST_MODE_ENABLED)
      : false;
    if (depositNetwork === "TRON TESTNET" && !isShastaTestUser) {
      return json({ error: "Shasta verification is restricted to the explicitly allowlisted test account.", code: "SHASTA_TEST_ACCOUNT_REQUIRED" }, 403);
    }
    const reviewApproved = ["APPROVED","MANUAL_APPROVED"].includes(String(deposit.ai_review_status || ""));
    const chainReviewEligible = isShastaTestUser && deposit.ai_review_status === "MANUAL_REVIEW";
    if (!deposit.screenshot_path || (!reviewApproved && !chainReviewEligible)) {
      return json({
        status: "PENDING_VERIFICATION",
        message: "Deposit evidence has not passed review and is not eligible for isolated Shasta on-chain review. No balance has been credited.",
      }, 202);
    }
    const shastaRules = isShastaTestUser ? await loadShastaTestRules(admin, SHASTA_TEST_MODE_ENABLED) : null;
    if (isShastaTestUser && !shastaRules) {
      return json({ error: "Shasta test mode is unavailable while live-money gates are open or test configuration is invalid.", code: "SHASTA_TEST_MODE_BLOCKED" }, 423);
    }
    const settingsKey = isShastaTestUser ? "shasta_testnet_rules" : "deposit_rules";
    const { data: settingsRow, error: settingsError } = await admin.from("platform_settings")
      .select("value_json").eq("key", settingsKey).maybeSingle();
    if (settingsError || !settingsRow?.value_json) return json({ error: "Deposit configuration is unavailable.", code: "DEPOSIT_CONFIG_UNAVAILABLE" }, 503);
    const rules = isShastaTestUser ? shastaRules! : settingsRow.value_json;
    const network = String(rules.network || "").toUpperCase();
    if (String(deposit.network || "").toUpperCase() !== network) {
      return json({ error: "Deposit network differs from the recorded request or current settings. Manual reconciliation is required.", code: "DEPOSIT_NETWORK_MISMATCH" }, 409);
    }
    if (network === "TRON TESTNET" &&
      (String(rules.token_contract || "").trim() !== SHASTA_TEST_USDT
        || String(deposit.token_contract || "") !== SHASTA_TEST_USDT
        || !deposit.deposit_wallet_id
        || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(deposit.receiving_address || "")))) {
      return json({ error: "Shasta verification requires the pinned USDT contract and this user's assigned HD deposit address.", code: "TESTNET_WALLET_OR_TOKEN_MISMATCH" }, 409);
    }

    let baseUrl = "";
    let contract = "";
    if (network === "TRON TESTNET") {
      if (String(rules.token_contract || "").trim() !== SHASTA_TEST_USDT) {
        return json({ error: "Shasta verification requires the pinned testnet USDT contract.", code: "UNSUPPORTED_TESTNET_TOKEN_CONTRACT" }, 403);
      }
      baseUrl = "https://api.shasta.trongrid.io";
      contract = SHASTA_TEST_USDT;
    } else if (network === "TRON MAINNET") {
      const mainnetTokenContract = String(rules.token_contract || "").trim();
      if (mainnetTokenContract !== MAINNET_USDT) {
        return json({ error: "Mainnet verification requires the official TRON USDT token contract.", code: "UNSUPPORTED_MAINNET_TOKEN_CONTRACT" }, 403);
      }
      const [
        { data: modeRow, error: modeError },
        { data: productionRow, error: productionError },
      ] = await Promise.all([
        admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle(),
        admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle(),
      ]);
      if (modeError || productionError || !modeRow?.value_json || !productionRow?.value_json) {
        return json({ error: "Unable to confirm production deposit readiness.", code: "DEPOSIT_READINESS_UNAVAILABLE" }, 503);
      }
      const mode = modeRow.value_json;
      const production = productionRow.value_json;
      const { data: unresolvedPayouts, error: unresolvedPayoutError } = await admin
        .from("withdrawal_requests").select("id").in("status", ["APPROVED", "PROCESSING"])
        .is("payout_txid", null).limit(1);
      if (unresolvedPayoutError) return json({ error: "Unable to confirm payout reconciliation status." }, 503);
      const payoutCredentialsReady = Boolean(
        TRONGRID_KEY && CRON_SECRET && MAINNET_PAYOUT_KEY && TELEGRAM_TOKEN &&
        TELEGRAM_CHAT_ID && TELEGRAM_APPROVER_IDS.length > 0
      );
      const mainnetDepositsOpen =
        mainnetTokenContract === MAINNET_USDT &&
        mode.mode === "MAINNET" &&
        mode.live_deposits === true &&
        mode.real_payouts === true &&
        mode.production_go_live_approved === true &&
        String(production.environment || "").toUpperCase() === "PRODUCTION" &&
        production.live_deposits_enabled === true &&
        production.real_payouts_enabled === true &&
        production.go_live_approved === true &&
        production.payouts_locked === false &&
        payoutCredentialsReady && (unresolvedPayouts || []).length === 0;
      if (!mainnetDepositsOpen) {
        return json({
          error: "Mainnet deposit verification is paused until production payouts are fully configured, approved, reconciled, and unlocked.",
          code: "MAINNET_DEPOSITS_PAUSED",
        }, 403);
      }
      baseUrl = "https://api.trongrid.io";
      contract = String(rules.token_contract || MAINNET_USDT).trim();
    } else {
      return json({ error: "Select a supported TRON network in deposit settings." }, 503);
    }
    let receiving = String(deposit.receiving_address || "").trim();
    if (deposit.deposit_wallet_id) {
      const { data: assignedWallet, error: assignedWalletError } = await admin.from("deposit_wallets")
        .select("id,address,network,token_contract").eq("id", deposit.deposit_wallet_id).eq("user_id", deposit.user_id).maybeSingle();
      if (assignedWalletError || !assignedWallet || assignedWallet.address !== receiving
        || String(assignedWallet.network || "").toUpperCase() !== network
        || String(assignedWallet.token_contract || "") !== contract) {
        return json({ error: "The deposit recipient does not match the user's recorded HD address. No balance was credited.", code: "DEPOSIT_RECIPIENT_MISMATCH" }, 409);
      }
      receiving = assignedWallet.address;
    } else if (!receiving) receiving = String(rules.receiving_address || "").trim();
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(receiving)) return json({ error: "A valid TRON receiving address is not configured." }, 503);
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(contract)) return json({ error: "A valid TRC-20 token contract is not configured." }, 503);

    const url = new URL(baseUrl + "/v1/accounts/" + encodeURIComponent(receiving) + "/transactions/trc20");
    url.searchParams.set("only_confirmed", "true");
    url.searchParams.set("only_to", "true");
    url.searchParams.set("limit", "200");
    url.searchParams.set("contract_address", contract);
    if (network === "TRON TESTNET") {
      const createdAt = new Date(deposit.created_at || Date.now()).getTime();
      // Narrow the provider query to the same safe lookback used by fallback matching.
      url.searchParams.set("min_block_timestamp", String(Math.max(0, createdAt - 24 * 60 * 60 * 1000)));
      url.searchParams.set("order_by", "block_timestamp,desc");
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (TRONGRID_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_KEY;
    const chainRes = await fetch(url, { headers });
    if (!chainRes.ok) return json({ error: "TRON verification service returned " + chainRes.status + "." }, 502);
    const chain = await chainRes.json();
    const transfers = Array.isArray(chain.data) ? chain.data : [];
    let match: any = null;
    if (network === "TRON TESTNET") {
      // Prefer a true TXID match if the user's claim exists on this recipient's
      // confirmed transfer list. If the claim is blank, malformed or not present,
      // search for a unique exact-amount transfer received in the prior 24 hours.
      const claimedTxid = isValidTronTxid(String(deposit.submitted_txid || "")) ? String(deposit.submitted_txid) : "";
      const canonicalTxid = isValidTronTxid(String(deposit.txid || "")) ? String(deposit.txid) : "";
      const preferredTxid = canonicalTxid || claimedTxid;
      match = preferredTxid ? findExactShastaUsdtTransfer(transfers, preferredTxid, receiving) : null;
      if (!match || !exactUsdtRawAmountMatches(match, deposit.gross_amount)) {
        const createdAt = new Date(deposit.created_at || Date.now()).getTime();
        const notBefore = Math.max(1, createdAt - 24 * 60 * 60 * 1000);
        const candidates = findShastaTransfersByAmount(transfers, receiving, deposit.gross_amount, notBefore);
        if (!candidates.length) {
          return json({ status: "PENDING_VERIFICATION", message: "No confirmed Shasta USDT transfer matches this amount and receiving address yet. No balance has been credited." }, 202);
        }
        const candidateTxids = candidates.map((x) => String(x.transaction_id));
        const { data: previouslyClaimed, error: claimLookupError } = await admin.from("deposit_submissions")
          .select("id,txid").eq("network", "TRON TESTNET").in("txid", candidateTxids).neq("id", deposit.id);
        if (claimLookupError) return json({ error: "Unable to confirm whether a matching transfer is already linked to another deposit.", code: "SHASTA_CLAIM_LOOKUP_FAILED" }, 503);
        const claimedIds = new Set((previouslyClaimed || []).map((x: any) => String(x.txid || "").toLowerCase()));
        const unclaimed = candidates.filter((x) => !claimedIds.has(String(x.transaction_id || "").toLowerCase()));
        if (unclaimed.length !== 1) {
          return json({
            status: "PENDING_VERIFICATION",
            code: unclaimed.length > 1 ? "SHASTA_MATCH_AMBIGUOUS" : "SHASTA_MATCH_ALREADY_LINKED",
            message: unclaimed.length > 1
              ? "More than one confirmed Shasta USDT transfer matches this amount and time window. No automatic credit was applied; manual review is required."
              : "The matching Shasta transfer is already linked to another deposit request. No duplicate credit was applied.",
          }, 202);
        }
        match = unclaimed[0];
      }
    } else {
      match = transfers.find((x: any) =>
        String(x.transaction_id).toLowerCase() === String(deposit.txid).toLowerCase()
        && String(x.to) === receiving
        && String(x.token_info?.address || contract) === contract
        && String(x.type || "Transfer") === "Transfer"
        && x.success !== false
      );
    }
    if (!match) return json({ status: "PENDING_VERIFICATION", message: "No matching confirmed transfer found yet. No balance has been credited." }, 202);
    if (network === "TRON TESTNET") {
      const blockTimestamp = Number(match.block_timestamp);
      const createdAt = new Date(deposit.created_at || Date.now()).getTime();
      if (!Number.isFinite(blockTimestamp) || blockTimestamp < createdAt - 24 * 60 * 60 * 1000 || blockTimestamp > Date.now() + 5 * 60 * 1000) {
        return json({ status: "PENDING_VERIFICATION", message: "The confirmed transfer timestamp is outside the safe 24-hour matching window. No credit was applied." }, 202);
      }
    }

    const raw = String(match.value || "0");
    let chainAmount: number;
    if (network === "TRON TESTNET") {
      if (!exactUsdtRawAmountMatches(match, deposit.gross_amount)) {
        return json({ error: "On-chain raw USDT amount does not exactly match the submitted deposit amount." }, 409);
      }
      chainAmount = Number(raw) / 1_000_000;
    } else {
      const decimals = Number(match.token_info?.decimals ?? 6);
      chainAmount = Number(raw) / Math.pow(10, decimals);
      const requestedAmount = Number(deposit.gross_amount);
      if (!Number.isFinite(chainAmount) || Math.abs(chainAmount - requestedAmount) > 0.000001) {
        return json({ error: "On-chain amount does not match the submitted deposit amount." }, 409);
      }
    }

    // Save the canonical TXID only after matching a confirmed on-chain transfer.
    // submitted_txid preserves the untrusted user hint for audit; txid is authoritative.
    if (network === "TRON TESTNET" && String(deposit.txid || "").toLowerCase() !== String(match.transaction_id).toLowerCase()) {
      const priorHint = String(deposit.submitted_txid || deposit.txid || "").trim().slice(0, 128);
      const { data: linked, error: linkError } = await admin.from("deposit_submissions")
        .update({
          txid: String(match.transaction_id),
          submitted_txid: priorHint || null,
          verification_note: "Canonical TXID discovered from a unique confirmed Shasta USDT transfer matching exact amount and recipient.",
        })
        .eq("id", deposit.id)
        .eq("status", "PENDING_VERIFICATION")
        .select("id")
        .maybeSingle();
      if (linkError || !linked) {
        return json({ error: "The confirmed transaction could not be linked uniquely to this deposit. No credit was applied.", code: "SHASTA_TXID_LINK_FAILED" }, 409);
      }
    }

    // A confirmed, exact Shasta TRC-20 transfer is stronger evidence than an
    // incomplete wallet receipt. Promote only after chain, contract, recipient,
    // success and exact raw amount have all matched. Mainnet review rules remain unchanged.
    if (network === "TRON TESTNET" && deposit.ai_review_status === "MANUAL_REVIEW") {
      const existingChecks = deposit.ai_checks && typeof deposit.ai_checks === "object" && !Array.isArray(deposit.ai_checks)
        ? deposit.ai_checks as Record<string, unknown>
        : {};
      const chainEvidence = {
        result: "CONFIRMED",
        network: "TRON TESTNET",
        token_contract: contract,
        receiving_address: receiving,
        txid: String(match.transaction_id),
        raw_amount: raw,
        block_timestamp: match.block_timestamp ? new Date(Number(match.block_timestamp)).toISOString() : null,
        verification_source: "TronGrid confirmed-only Shasta transfer query",
      };
      const { data: reviewRow, error: reviewError } = await admin.from("deposit_submissions")
        .update({
          ai_review_status: "APPROVED",
          ai_review_reason: "CHAIN_VERIFIED_SHASTA_TRANSFER",
          ai_reviewed_at: new Date().toISOString(),
          ai_checks: { ...existingChecks, chain_verification: chainEvidence },
          ai_policy_version: "SHASTA_CHAIN_VERIFICATION_V1",
        })
        .eq("id", deposit.id)
        .eq("status", "PENDING_VERIFICATION")
        .eq("ai_review_status", "MANUAL_REVIEW")
        .select("id")
        .maybeSingle();
      if (reviewError || !reviewRow) {
        return json({ error: "The Shasta transfer was confirmed, but its review state changed concurrently. No balance was credited; refresh and retry.", code: "CHAIN_REVIEW_STATE_CHANGED" }, 409);
      }
    }

    const { data: applied, error: applyError } = await admin.rpc("apply_verified_deposit", {
      p_deposit_id: deposit.id,
      p_sender_address: String(match.from || ""),
      p_raw_amount: raw,
      p_block_timestamp: match.block_timestamp ? new Date(Number(match.block_timestamp)).toISOString() : null,
      p_verification_source: "TronGrid",
    });
    if (applyError) return json({ error: applyError.message }, 500);
    return json({ status: "VERIFIED", deposit: applied, txid: match.transaction_id, amount: chainAmount });
  } catch {
    return json({ error: "Unable to verify deposit." }, 500);
  }
});
