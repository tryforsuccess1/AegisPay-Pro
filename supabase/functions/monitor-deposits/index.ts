import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  exactUsdtRawAmountMatches,
  findExactShastaUsdtTransfer,
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
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function verifyOne(admin: any, deposit: any, receiving: string, baseUrl: string, contract: string, network: string) {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(receiving)) return { id: deposit.id, status: "MISSING_RECEIVING_ADDRESS" };
  if (network === "TRON TESTNET") {
    if (String(deposit.network || "").toUpperCase() !== "TRON TESTNET"
      || String(deposit.token_contract || "") !== SHASTA_TEST_USDT
      || contract !== SHASTA_TEST_USDT
      || !deposit.deposit_wallet_id
      || String(deposit.receiving_address || "") !== receiving) {
      return { id: deposit.id, status: "TESTNET_WALLET_OR_TOKEN_MISMATCH" };
    }
    const { data: assigned, error: assignedError } = await admin.from("deposit_wallets")
      .select("id,address,network,token_contract").eq("id", deposit.deposit_wallet_id)
      .eq("user_id", deposit.user_id).maybeSingle();
    if (assignedError || !assigned || assigned.address !== receiving
      || String(assigned.network || "").toUpperCase() !== "TRON TESTNET"
      || String(assigned.token_contract || "") !== SHASTA_TEST_USDT) {
      return { id: deposit.id, status: "TESTNET_WALLET_ASSIGNMENT_MISMATCH" };
    }
  }
  const url = new URL(baseUrl + "/v1/accounts/" + encodeURIComponent(receiving) + "/transactions/trc20");
  url.searchParams.set("only_confirmed", "true");
  url.searchParams.set("only_to", "true");
  url.searchParams.set("limit", "200");
  url.searchParams.set("contract_address", contract);
  const headers: Record<string, string> = { accept: "application/json" };
  if (TRONGRID_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_KEY;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("TronGrid " + response.status);
  const payload = await response.json();
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const match = network === "TRON TESTNET"
    ? findExactShastaUsdtTransfer(rows, String(deposit.txid || ""), receiving)
    : rows.find((x: any) =>
      String(x.transaction_id).toLowerCase() === String(deposit.txid).toLowerCase()
      && String(x.to) === receiving
      && String(x.token_info?.address || contract) === contract
      && x.success !== false
    );
  if (!match) return { id: deposit.id, status: "PENDING" };

  const raw = String(match.value || "0");
  let amount: number;
  if (network === "TRON TESTNET") {
    if (!exactUsdtRawAmountMatches(match, deposit.gross_amount)) {
      return { id: deposit.id, status: "AMOUNT_MISMATCH" };
    }
    amount = Number(raw) / 1_000_000;
  } else {
    const decimals = Number(match.token_info?.decimals ?? 6);
    amount = Number(raw) / Math.pow(10, decimals);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(deposit.gross_amount)) > 0.000001) {
      return { id: deposit.id, status: "AMOUNT_MISMATCH" };
    }
  }
  const { error } = await admin.rpc("apply_verified_deposit", {
    p_deposit_id: deposit.id,
    p_sender_address: String(match.from || ""),
    p_raw_amount: raw,
    p_block_timestamp: match.block_timestamp ? new Date(Number(match.block_timestamp)).toISOString() : null,
    p_verification_source: "TronGrid Monitor",
  });
  return { id: deposit.id, status: error ? "ERROR" : "VERIFIED" };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Deposit monitor is not configured." }, 503);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const suppliedSecret = req.headers.get("x-aegis-cron-secret");
    const environmentSecretMatches = Boolean(CRON_SECRET && suppliedSecret && suppliedSecret === CRON_SECRET);
    if (!environmentSecretMatches) {
      if (!suppliedSecret) return json({ error: "Unauthorized." }, 401);
      const { data: secretMatches, error: secretError } = await admin.rpc("verify_deposit_monitor_cron_secret", { p_token: suppliedSecret });
      if (secretError || secretMatches !== true) return json({ error: "Unauthorized." }, 401);
    }
    const { data: appEnabled, error: runtimeError } = await admin.rpc("app_runtime_enabled");
    if (runtimeError) return json({ error: "Unable to confirm AegisPay runtime status." }, 503);
    if (appEnabled !== true) return json({ appEnabled: false, checked: 0, results: [] });
    const { data: rulesRow } = await admin.from("platform_settings").select("value_json").eq("key", "deposit_rules").maybeSingle();
    const rules = rulesRow?.value_json || {};
    const network = String(rules.network || "").toUpperCase();
    const receiving = String(rules.receiving_address || "").trim();
    if (network === "TRON MAINNET" && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(receiving)) {
      return json({ error: "Valid Mainnet receiving address is not configured." }, 503);
    }
    const shastaRules = await loadShastaTestRules(admin, SHASTA_TEST_MODE_ENABLED);

    const { data: pending, error } = await admin.from("deposit_submissions").select("*")
      .eq("status", "PENDING_VERIFICATION")
      .in("ai_review_status", ["APPROVED","MANUAL_APPROVED"])
      .order("created_at", { ascending: true }).limit(100);
    if (error) return json({ error: "Unable to load pending deposits." }, 500);

    let mainnetDepositsOpen = false;
    if (network === "TRON MAINNET") {
      const mainnetTokenContract = String(rules.token_contract || "").trim();
      if (mainnetTokenContract !== MAINNET_USDT) {
        return json({ error: "Mainnet deposit monitoring requires the official TRON USDT token contract.", code: "UNSUPPORTED_MAINNET_TOKEN_CONTRACT" }, 403);
      }
      const [{ data: modeRow, error: modeError }, { data: productionRow, error: productionError }] = await Promise.all([
        admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle(),
        admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle(),
      ]);
      if (modeError || productionError || !modeRow?.value_json || !productionRow?.value_json) {
        return json({ error: "Unable to confirm production deposit readiness." }, 503);
      }
      const mode = modeRow.value_json;
      const production = productionRow.value_json;
      const { data: unresolvedPayouts, error: unresolvedPayoutError } = await admin
        .from("withdrawal_requests").select("id").in("status", ["APPROVED", "PROCESSING"])
        .is("payout_txid", null).limit(1);
      if (unresolvedPayoutError) return json({ error: "Unable to confirm payout reconciliation status." }, 503);
      const payoutCredentialsReady = Boolean(TRONGRID_KEY && CRON_SECRET && MAINNET_PAYOUT_KEY && TELEGRAM_TOKEN && TELEGRAM_CHAT_ID && TELEGRAM_APPROVER_IDS.length > 0);
      mainnetDepositsOpen =
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
      // Keep scanning eligible Shasta test deposits while Mainnet remains paused.
      // Mainnet rows are separately skipped below unless this full readiness gate passes.
      if (mainnetDepositsOpen && !TRONGRID_KEY) {
        if (!pending?.length) return json({ monitorStatus: "AWAITING_PROVIDER_KEY", checked: 0, results: [] });
        return json({ error: "TRONGRID_API_KEY is not configured; approved deposits cannot be checked automatically." }, 503);
      }
    }

    let baseUrl = "";
    let contract = "";
    if (network === "TRON TESTNET") {
      if (String(rules.token_contract || "").trim() !== SHASTA_TEST_USDT) {
        return json({ error: "Shasta monitoring requires the pinned testnet USDT contract.", code: "UNSUPPORTED_TESTNET_TOKEN_CONTRACT" }, 403);
      }
      baseUrl = "https://api.shasta.trongrid.io";
      contract = SHASTA_TEST_USDT;
    } else if (network === "TRON MAINNET") {
      baseUrl = "https://api.trongrid.io";
      contract = String(rules.token_contract || MAINNET_USDT).trim();
    } else {
      return json({ error: "Unsupported TRON network." }, 503);
    }
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(contract)) return json({ error: "Valid TRC-20 contract is not configured." }, 503);

    const results = [];
    for (const deposit of pending || []) {
      try {
        const depositNetwork = String(deposit.network || "").toUpperCase();
        if (depositNetwork === "TRON TESTNET") {
          if (!shastaRules) {
            results.push({ id: deposit.id, status: "SHASTA_TEST_MODE_BLOCKED" });
            continue;
          }
          const isTestUser = await isAllowlistedShastaTestUser(admin, String(deposit.user_id || ""), SHASTA_TEST_MODE_ENABLED);
          if (!isTestUser) {
            results.push({ id: deposit.id, status: "SHASTA_TEST_ACCOUNT_REQUIRED" });
            continue;
          }
          if (String(deposit.token_contract || "") !== SHASTA_TEST_USDT) {
            results.push({ id: deposit.id, status: "TESTNET_TOKEN_MISMATCH" });
            continue;
          }
          const testReceiver = String(deposit.receiving_address || "").trim();
          results.push(await verifyOne(admin, deposit, testReceiver, "https://api.shasta.trongrid.io", SHASTA_TEST_USDT, "TRON TESTNET"));
          continue;
        }
        if (depositNetwork === "TRON MAINNET") {
          if (!mainnetDepositsOpen || network !== "TRON MAINNET" || contract !== MAINNET_USDT) {
            results.push({ id: deposit.id, status: "MAINNET_DEPOSITS_PAUSED" });
            continue;
          }
          const perDepositReceiver = String(deposit.receiving_address || (deposit.deposit_wallet_id ? "" : receiving)).trim();
          results.push(await verifyOne(admin, deposit, perDepositReceiver, "https://api.trongrid.io", contract, "TRON MAINNET"));
          continue;
        }
        results.push({ id: deposit.id, status: "UNSUPPORTED_DEPOSIT_NETWORK" });
      } catch {
        results.push({ id: deposit.id, status: "ERROR" });
      }
    }
    return json({ checked: results.length, results, mainnetDepositsOpen });
  } catch {
    return json({ error: "Deposit monitor failed." }, 500);
  }
});

