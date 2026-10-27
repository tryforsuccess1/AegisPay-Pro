import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TronWeb } from "npm:tronweb@6.0.4";
import { deriveTronHdIdentity } from "../_shared/tron-hd-wallet.ts";
import { checkWithdrawalPayoutHdConfig, estimatePayoutFeeReserveSun } from "../_shared/withdrawal-payout-wallet.ts";
import { isAllowlistedShastaTestUser, isAllowlistedShastaTestWithdrawal, isIsolatedShastaPayoutEligible, loadShastaTestRules } from "../_shared/shasta-test-mode.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MAINNET_PAYOUT_KEY = Deno.env.get("TRON_MAINNET_TREASURY_PRIVATE_KEY") || Deno.env.get("TRON_PAYOUT_PRIVATE_KEY") || "";
const TESTNET_PAYOUT_KEY = Deno.env.get("TRON_SHASTA_TREASURY_PRIVATE_KEY") || Deno.env.get("TRON_TESTNET_PAYOUT_PRIVATE_KEY") || "";
const TRONGRID_KEY = Deno.env.get("TRONGRID_API_KEY");
const MAINNET_WITHDRAWAL_PAYOUT_MODE = Deno.env.get("TRON_MAINNET_WITHDRAWAL_PAYOUT_MODE") || "DISABLED";
const MAINNET_WITHDRAWAL_HD_MNEMONIC = Deno.env.get("TRON_MAINNET_WITHDRAWAL_HD_MNEMONIC") || "";
const MAINNET_WITHDRAWAL_HD_PASSPHRASE = Deno.env.get("TRON_MAINNET_WITHDRAWAL_HD_PASSPHRASE") || "";
const MAINNET_DEPOSIT_HD_MNEMONIC = Deno.env.get("TRON_MAINNET_CHILD_HD_MNEMONIC") || Deno.env.get("TRON_HD_WALLET_MNEMONIC") || "";
const SHASTA_HD_MNEMONIC = Deno.env.get("TRON_SHASTA_CHILD_HD_MNEMONIC") || Deno.env.get("TRON_TESTNET_HD_WALLET_MNEMONIC") || "";
const MAINNET_WITHDRAWAL_MAX_FEE_TRX = Number(Deno.env.get("TRON_MAINNET_WITHDRAWAL_MAX_FEE_TRX") || "80");
const SHASTA_WITHDRAWAL_PAYOUT_MODE = Deno.env.get("TRON_SHASTA_WITHDRAWAL_PAYOUT_MODE") || "DISABLED";
const SHASTA_WITHDRAWAL_HD_MNEMONIC = Deno.env.get("TRON_SHASTA_WITHDRAWAL_HD_MNEMONIC") || "";
const SHASTA_WITHDRAWAL_HD_PASSPHRASE = Deno.env.get("TRON_SHASTA_WITHDRAWAL_HD_PASSPHRASE") || "";
const SHASTA_WITHDRAWAL_MAX_FEE_TRX = Number(Deno.env.get("TRON_SHASTA_WITHDRAWAL_MAX_FEE_TRX") || "80");
const MAINNET_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SHASTA_USDT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function errorMessage(error: unknown) {
  return String((error as Error)?.message || error).slice(0, 500);
}

function safeTxid(value: unknown): string {
  if (typeof value === "string") return value;
  const row = value as any;
  return String(row?.txid || row?.txID || row?.transaction?.txID || row?.transaction?.txid || "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTransactionInfo(tron: any, txid: string): Promise<any> {
  for (let attempt = 0; attempt < 20; attempt++) {
    let info: any = null;
    try { info = await tron.trx.getTransactionInfo(txid); } catch { info = null; }
    const returnedId = String(info?.id || info?.txID || "").toLowerCase();
    const blockNumber = Number(info?.blockNumber || 0);
    if (info && blockNumber > 0 && (!returnedId || returnedId === txid.toLowerCase())) {
      const result = String(info?.receipt?.result || "").toUpperCase();
      if (result && result !== "SUCCESS") throw new Error("TRON_TRANSACTION_FAILED");
      return info;
    }
    await sleep(1000);
  }
  throw new Error("TRON_TRANSACTION_CONFIRMATION_PENDING");
}

function expectedAddressTopic(address: string): string {
  return TronWeb.address.toHex(address).replace(/^41/i, "").toLowerCase().padStart(64, "0");
}

function normalizeTronHexAddress(value: unknown): string {
  return String(value || "").replace(/^0x/i, "").replace(/^41/i, "").toLowerCase();
}

function hasExpectedUsdtTransfer(info: any, tokenContract: string, from: string, to: string, amountRaw: string): boolean {
  const tokenHex = normalizeTronHexAddress(TronWeb.address.toHex(tokenContract));
  const transferTopic = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const expectedFrom = expectedAddressTopic(from);
  const expectedTo = expectedAddressTopic(to);
  const expectedAmount = BigInt(amountRaw).toString(16).padStart(64, "0").toLowerCase();
  const logs = Array.isArray(info?.log) ? info.log : [];
  return logs.some((entry: any) => {
    const logAddress = normalizeTronHexAddress(entry?.address);
    const topics = Array.isArray(entry?.topics)
      ? entry.topics.map((x: unknown) => String(x || "").replace(/^0x/i, "").toLowerCase())
      : [];
    const data = String(entry?.data || "").replace(/^0x/i, "").toLowerCase().padStart(64, "0");
    return logAddress === tokenHex &&
      topics[0] === transferTopic &&
      topics[1] === expectedFrom &&
      topics[2] === expectedTo &&
      data === expectedAmount;
  });
}

async function estimateUsdtTransferEnergy(
  chain: string,
  tokenContract: string,
  senderAddress: string,
  destinationAddress: string,
  amountRaw: string,
): Promise<{ energyRequired: number; energyFeeSun: number }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (TRONGRID_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_KEY;
  const destinationHex = TronWeb.address.toHex(destinationAddress).replace(/^41/i, "");
  const parameter = destinationHex.padStart(64, "0") + BigInt(amountRaw).toString(16).padStart(64, "0");
  const estimateResponse = await fetch(chain + "/wallet/estimateenergy", {
    method: "POST",
    headers,
    body: JSON.stringify({
      owner_address: TronWeb.address.toHex(senderAddress),
      contract_address: TronWeb.address.toHex(tokenContract),
      function_selector: "transfer(address,uint256)",
      parameter,
      visible: false,
    }),
  });
  if (!estimateResponse.ok) throw new Error("PAYOUT_ENERGY_ESTIMATE_UNAVAILABLE");
  const estimate = await estimateResponse.json().catch(() => null);
  const energyRequired = Number(estimate?.energy_required);
  if (!Number.isSafeInteger(energyRequired) || energyRequired <= 0 || energyRequired > 1_000_000) {
    throw new Error("PAYOUT_ENERGY_ESTIMATE_INVALID");
  }

  const paramsResponse = await fetch(chain + "/wallet/getchainparameters", {
    method: "POST", headers, body: "{}",
  });
  if (!paramsResponse.ok) throw new Error("PAYOUT_CHAIN_FEE_PARAMETERS_UNAVAILABLE");
  const params = await paramsResponse.json().catch(() => null);
  const entries = Array.isArray(params?.chainParameter) ? params.chainParameter : [];
  const energyFeeSun = Number(entries.find((x: any) => x?.key === "getEnergyFee")?.value);
  if (!Number.isSafeInteger(energyFeeSun) || energyFeeSun <= 0 || energyFeeSun > 1_000_000) {
    throw new Error("PAYOUT_CHAIN_ENERGY_FEE_INVALID");
  }
  return { energyRequired, energyFeeSun };
}

async function updateWithdrawalPayoutJournal(admin: any, withdrawalId: string, patch: Record<string, unknown>) {
  const { error } = await admin.from("withdrawal_payout_journal").update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq("withdrawal_id", withdrawalId);
  if (error) throw new Error("PAYOUT_JOURNAL_UPDATE_FAILED");
}

function usdtUnits(value: unknown) {
  const decimal = String(value ?? "");
  if (!/^\d+(?:\.\d{1,6})?$/.test(decimal)) {
    throw new Error("Withdrawal net amount is invalid.");
  }

  const [whole, fraction = ""] = decimal.split(".");
  const units = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  if (units <= 0n) throw new Error("Withdrawal net amount must be greater than zero.");
  return units.toString();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

let admin: ReturnType<typeof createClient<any>> | null = null;
let withdrawalId: string | null = null;
let claimedWithdrawal: any = null;
let payoutMayHaveBeenBroadcast = false;
let ephemeralPayout = false;
let selectedPayoutHdMnemonic = "";
let selectedPayoutHdPassphrase = "";
let selectedPayoutMaxFeeTrx = 80;
let payoutJournalStarted = false;

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Payout service is not configured." }, 503);
    }
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authorization required." }, 401);

    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authResult, error: authError } = await admin.auth.getUser(token);
    if (authError || !authResult.user) return json({ error: "Invalid authentication token." }, 401);

    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("id,role,status")
      .eq("auth_user_id", authResult.user.id)
      .maybeSingle();
    if (profileError || !profile) return json({ error: "AegisPay profile not found." }, 404);
    if (!["ACTIVE", "NORMAL"].includes(String(profile.status || "").toUpperCase())) {
      return json({ error: "Active account access is required." }, 403);
    }

    // AI may request payout execution only for this authenticated client's own,
    // policy-approved withdrawal. The normal Master Admin flow is unchanged.
    const body = await req.json().catch(() => null);
    withdrawalId = typeof body?.withdrawalId === "string" ? body.withdrawalId : null;
    if (!withdrawalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(withdrawalId)) {
      return json({ error: "A valid withdrawalId is required." }, 400);
    }
    let aiApprovedClientPayout = false;
    if (profile.role !== "MASTER ADMIN") {
      if (profile.role !== "USER") return json({ error: "Master Admin access required." }, 403);
      const [{ data: ownRequest, error: ownError }, { data: aiSettings, error: aiSettingsError }] = await Promise.all([
        admin.from("withdrawal_requests").select("id,user_id,status,panel_decision,telegram_decision,ai_decision,payout_txid")
          .eq("id", withdrawalId).eq("user_id", profile.id).maybeSingle(),
        admin.from("platform_settings").select("value_json").eq("key", "withdrawal_ai").maybeSingle(),
      ]);
      if (ownError || aiSettingsError) return json({ error: "Unable to verify AI-approved withdrawal permissions." }, 503);
      if (!ownRequest || ownRequest.ai_decision !== "AUTO_APPROVED" ||
          ownRequest.status !== "APPROVED" || ownRequest.panel_decision !== "APPROVED" ||
          ownRequest.telegram_decision !== "APPROVED" || ownRequest.payout_txid ||
          aiSettings?.value_json?.enabled !== true) {
        return json({ error: "Only your own currently AI-approved withdrawal can use automatic payout processing." }, 403);
      }
      aiApprovedClientPayout = true;
    }

    // Load the payout target once so Shasta routing can be tied to its owner; a feature flag alone must never route an ordinary withdrawal to testnet.
    const { data: payoutTarget, error: payoutTargetError } = await admin
      .from("withdrawal_requests")
      .select("id,user_id,destination_address")
      .eq("id", withdrawalId)
      .maybeSingle();
    if (payoutTargetError) return json({ error: "Unable to verify the withdrawal destination. No transaction was sent." }, 500);
    if (!payoutTarget) return json({ error: "Withdrawal request not found. No transaction was sent." }, 404);

    const { data: appEnabled, error: runtimeError } = await admin.rpc("app_runtime_enabled");
    if (runtimeError) return json({ error: "Unable to confirm AegisPay runtime status." }, 503);
    if (appEnabled !== true) return json({ error: "AegisPay is paused by Master Admin." }, 423);

    const { data: modeRow } = await admin.from("platform_settings")
      .select("value_json").eq("key", "system_mode").maybeSingle();
    const systemMode = modeRow?.value_json || {};
    const { data: networkRow, error: networkError } = await admin.from("platform_settings")
      .select("value_json").eq("key", "deposit_rules").maybeSingle();
    if (networkError) return json({ error: "Unable to confirm configured payout network." }, 503);
    // Shasta routing requires both the explicit server-side flag and a row-level test-user allowlist.
    // loadShastaTestRules also fails closed unless all production-money gates remain closed and the two networks are configured distinctly.
    const shastaTestPayoutsEnabled = Deno.env.get("TRON_SHASTA_TEST_PAYOUTS_ENABLED") === "true";
    const shastaTestUserAllowed = await isAllowlistedShastaTestUser(
      admin,
      String(payoutTarget.user_id || ""),
      shastaTestPayoutsEnabled,
    );
    // Test-user status alone is not enough: allowlist the exact withdrawal separately,
    // so another ordinary request from the same account can never be silently routed to Shasta.
    const shastaTestWithdrawalAllowed = await isAllowlistedShastaTestWithdrawal(
      admin,
      withdrawalId,
      shastaTestPayoutsEnabled,
      String(payoutTarget.destination_address || ""),
    );
    const shastaRules = shastaTestUserAllowed && shastaTestWithdrawalAllowed
      ? await loadShastaTestRules(admin, shastaTestPayoutsEnabled)
      : null;
    const isolatedShasta = isIsolatedShastaPayoutEligible(
      shastaTestPayoutsEnabled,
      systemMode.mode,
      shastaTestUserAllowed,
      shastaTestWithdrawalAllowed,
      shastaRules,
    );
    const payoutNetworkRow = isolatedShasta ? { value_json: shastaRules } : networkRow;
    const network = String(payoutNetworkRow?.value_json?.network || "").toUpperCase();

    const { data: productionRow, error: productionError } = await admin.from("platform_settings")
      .select("value_json").eq("key", "production_config").maybeSingle();
    if (productionError) return json({ error: "Unable to confirm production payout gate." }, 503);
    const productionConfig = productionRow?.value_json || {};

    const testnet = (systemMode.mode === "TESTNET_DEMO" && systemMode.testnet_payouts === true && network === "TRON TESTNET") || isolatedShasta;
    const mainnet = systemMode.mode === "MAINNET"
      && systemMode.real_payouts === true
      && systemMode.production_go_live_approved === true
      && network === "TRON MAINNET"
      && productionConfig.go_live_approved === true
      && productionConfig.real_payouts_enabled === true
      && productionConfig.payouts_locked === false
      && String(productionConfig.environment || "").toUpperCase() === "PRODUCTION";

    // A withdrawal explicitly marked for Shasta testing must never fall through to Mainnet.
    if (shastaTestWithdrawalAllowed && !isolatedShasta) {
      return json({
        error: "This withdrawal is marked for isolated Shasta testing, but its test payout gates are not ready. No payout was sent.",
        code: "SHASTA_TEST_WITHDRAWAL_NOT_READY",
      }, 403);
    }

    if (mainnet) {
      const payoutHdConfig = checkWithdrawalPayoutHdConfig(
        MAINNET_WITHDRAWAL_PAYOUT_MODE,
        MAINNET_WITHDRAWAL_HD_MNEMONIC,
        MAINNET_DEPOSIT_HD_MNEMONIC,
        SHASTA_HD_MNEMONIC,
      );
      if (!payoutHdConfig.ready) {
        return json({
          error: "Per-withdrawal payout sender-wallet mode is not configured with a dedicated Mainnet HD seed. No payout was sent.",
          code: "WITHDRAWAL_PAYOUT_HD_NOT_READY",
        }, 503);
      }
      if (!TRONGRID_KEY) {
        return json({ error: "TRONGrid API key is required for per-withdrawal payout verification. No payout was sent.", code: "PAYOUT_TRONGRID_REQUIRED" }, 503);
      }
      if (!Number.isFinite(MAINNET_WITHDRAWAL_MAX_FEE_TRX) || MAINNET_WITHDRAWAL_MAX_FEE_TRX < 3 || MAINNET_WITHDRAWAL_MAX_FEE_TRX > 100) {
        return json({ error: "The per-withdrawal payout fee cap is invalid. No payout was sent.", code: "PAYOUT_FEE_CAP_INVALID" }, 503);
      }
      ephemeralPayout = true;
      selectedPayoutHdMnemonic = MAINNET_WITHDRAWAL_HD_MNEMONIC;
      selectedPayoutHdPassphrase = MAINNET_WITHDRAWAL_HD_PASSPHRASE;
      selectedPayoutMaxFeeTrx = MAINNET_WITHDRAWAL_MAX_FEE_TRX;
    }

    // Isolated Shasta payouts must always use a dedicated per-withdrawal sender wallet.
    // Never silently fall back to sending from the Shasta treasury when HD mode is disabled or misconfigured.
    if (isolatedShasta && String(SHASTA_WITHDRAWAL_PAYOUT_MODE || "").trim().toUpperCase() !== "EPHEMERAL_HD") {
      return json({
        error: "Isolated Shasta test payouts require TRON_SHASTA_WITHDRAWAL_PAYOUT_MODE=EPHEMERAL_HD. No payout was sent.",
        code: "SHASTA_EPHEMERAL_PAYOUT_MODE_REQUIRED",
        noPayoutSent: true,
      }, 503);
    }

    if (testnet && String(SHASTA_WITHDRAWAL_PAYOUT_MODE || "").trim().toUpperCase() === "EPHEMERAL_HD") {
      const payoutHdConfig = checkWithdrawalPayoutHdConfig(
        SHASTA_WITHDRAWAL_PAYOUT_MODE,
        SHASTA_WITHDRAWAL_HD_MNEMONIC,
        SHASTA_HD_MNEMONIC,
        MAINNET_DEPOSIT_HD_MNEMONIC,
      );
      if (!payoutHdConfig.ready) {
        const configSummary = [
          "modeEnabled=" + payoutHdConfig.modeEnabled,
          "dedicatedSeedPresent=" + payoutHdConfig.mnemonicPresent,
          "differentFromShastaDeposit=" + payoutHdConfig.distinctFromDepositSeed,
          "differentFromMainnetDeposit=" + payoutHdConfig.distinctFromShastaSeed,
        ].join(", ");
        return json({
          error: "Per-withdrawal Shasta sender-wallet mode requires a dedicated testnet HD seed. No payout was sent. Config checks: " + configSummary,
          code: "SHASTA_WITHDRAWAL_PAYOUT_HD_NOT_READY",
          // Safe diagnostics only: booleans only; never expose seed/private-key material.
          configChecks: {
            modeEnabled: payoutHdConfig.modeEnabled,
            mnemonicPresent: payoutHdConfig.mnemonicPresent,
            distinctFromShastaDepositSeed: payoutHdConfig.distinctFromDepositSeed,
            distinctFromMainnetDepositSeed: payoutHdConfig.distinctFromShastaSeed,
          },
        }, 503);
      }
      if (!TRONGRID_KEY) return json({ error: "TRONGrid API key is required for per-withdrawal testnet payout verification.", code: "PAYOUT_TRONGRID_REQUIRED" }, 503);
      if (!Number.isFinite(SHASTA_WITHDRAWAL_MAX_FEE_TRX) || SHASTA_WITHDRAWAL_MAX_FEE_TRX < 3 || SHASTA_WITHDRAWAL_MAX_FEE_TRX > 100) {
        return json({ error: "The Shasta per-withdrawal payout fee cap is invalid.", code: "PAYOUT_FEE_CAP_INVALID" }, 503);
      }
      ephemeralPayout = true;
      selectedPayoutHdMnemonic = SHASTA_WITHDRAWAL_HD_MNEMONIC;
      selectedPayoutHdPassphrase = SHASTA_WITHDRAWAL_HD_PASSPHRASE;
      selectedPayoutMaxFeeTrx = SHASTA_WITHDRAWAL_MAX_FEE_TRX;
    }

    if (systemMode.mode === "MAINNET" && network === "TRON MAINNET" && systemMode.real_payouts === true && !mainnet) {
      return json({ error: "Production payout gate is locked. Complete the Phase 3 go-live checks before enabling real payouts." }, 403);
    }
    if (!testnet && !mainnet) {
      const isolatedShastaCandidate = String(systemMode.mode || "").toUpperCase() === "MAINNET"
        && systemMode.real_payouts !== true
        && network === "TRON MAINNET";
      return json({
        error: isolatedShastaCandidate
          ? "Mainnet payouts are locked, and an isolated Shasta test payout is not currently eligible. Verify TRON_SHASTA_TEST_PAYOUTS_ENABLED=true, the test-user allowlist, the exact withdrawal/destination allowlist, and Shasta configuration. No payout was sent."
          : "The selected TRON network is not enabled for payouts. No payout was sent.",
        code: "PAYOUT_NETWORK_DISABLED",
        noPayoutSent: true,
      }, 403);
    }
    const payoutKey = testnet ? TESTNET_PAYOUT_KEY : MAINNET_PAYOUT_KEY;
    if (!payoutKey) return json({ error: testnet ? "TRON_TESTNET_PAYOUT_PRIVATE_KEY is not configured." : "TRON_PAYOUT_PRIVATE_KEY is not configured." }, 503);
    const tokenContract = String(payoutNetworkRow?.value_json?.token_contract || "");
    if (testnet && tokenContract !== SHASTA_USDT) return json({ error: "The testnet USDT contract does not match the supported Shasta token." }, 403);
    if (mainnet && tokenContract && tokenContract !== MAINNET_USDT) return json({ error: "The configured token is not the supported TRON mainnet USDT contract." }, 403);
    const chain = testnet ? "https://api.shasta.trongrid.io" : "https://api.trongrid.io";
    const usdtContract = testnet ? SHASTA_USDT : MAINNET_USDT;

    // Fail closed before claiming a withdrawal if the configured treasury and signer do not match.
    const configuredTreasury = String(payoutNetworkRow?.value_json?.receiving_address || "").trim();
    const signerAddress = String(TronWeb.address.fromPrivateKey(payoutKey) || "");
    if (!configuredTreasury || signerAddress !== configuredTreasury) {
      return json({ error: "Payout signer does not match the configured treasury address. No transaction was sent.", code: "PAYOUT_TREASURY_MISMATCH" }, 409);
    }

    // Validate the exact case-sensitive recipient before claiming the payout. TRON addresses
    // use Base58Check and changing letter case can redirect or invalidate a transfer.
    const { data: destinationValid, error: destinationValidationError } = await admin.rpc("is_valid_tron_address", {
      p_address: String(payoutTarget.destination_address || "")
    });
    if (destinationValidationError || destinationValid !== true) {
      return json({
        error: "Withdrawal destination is not a valid exact-case TRON Base58Check address. No transaction was sent. Master Admin must verify the correct wallet and reconcile this request.",
        code: "INVALID_WITHDRAWAL_DESTINATION",
        withdrawalId,
      }, 409);
    }

    if (ephemeralPayout) {
      const { data: existingJournal, error: existingJournalError } = await admin
        .from("withdrawal_payout_journal")
        .select("status,payout_txid")
        .eq("withdrawal_id", withdrawalId)
        .maybeSingle();
      if (existingJournalError) return json({ error: "Unable to confirm payout journal state. No payout was sent.", code: "PAYOUT_JOURNAL_UNAVAILABLE" }, 503);
      if (existingJournal) return json({
        error: "This withdrawal already has a per-withdrawal payout journal. Reconcile its on-chain stages before any retry.",
        code: "PAYOUT_JOURNAL_RECONCILIATION_REQUIRED",
        status: existingJournal.status,
        txidRecorded: Boolean(existingJournal.payout_txid),
      }, 409);
    }

    // Atomic claim: only one invocation can transition an approved request to PROCESSING.
    let claimQuery = admin
      .from("withdrawal_requests")
      .update({
        status: "PROCESSING",
        payout_started_at: new Date().toISOString(),
        payout_error: null,
      })
      .eq("id", withdrawalId)
      .eq("status", "APPROVED")
      .eq("panel_decision", "APPROVED")
      .eq("telegram_decision", "APPROVED");
    if (aiApprovedClientPayout) claimQuery = claimQuery.eq("ai_decision", "AUTO_APPROVED");
    claimQuery = claimQuery.is("payout_txid", null);
    const { data: withdrawal, error: claimError } = await claimQuery
      .select("id,user_id,net_amount,destination_address,panel_decision,telegram_decision")
      .maybeSingle();

    if (claimError) return json({ error: "Unable to lock the approved withdrawal." }, 500);
    if (!withdrawal) {
      return json({ error: "Withdrawal is unavailable or has already been claimed." }, 409);
    }
    claimedWithdrawal = withdrawal;

    if (testnet) {
      const { data: currentMode, error: currentModeError } = await admin.from("platform_settings")
        .select("value_json").eq("key", "system_mode").maybeSingle();
      if (currentModeError) throw new Error("Unable to revalidate testnet payout mode.");
      if (isolatedShasta) {
        const { data: currentShasta, error: currentShastaError } = await admin.from("platform_settings")
          .select("value_json").eq("key", "shasta_testnet_rules").maybeSingle();
        const currentRules = currentShasta?.value_json || {};
        if (currentShastaError || Deno.env.get("TRON_SHASTA_TEST_PAYOUTS_ENABLED") !== "true" ||
            currentMode?.value_json?.mode !== "MAINNET" ||
            String(currentRules.network || "").toUpperCase() !== "TRON TESTNET" ||
            String(currentRules.token_contract || "") !== SHASTA_USDT ||
            String(currentRules.receiving_address || "").trim() !== configuredTreasury) {
          throw new Error("Isolated Shasta test payouts were disabled or their rules changed before broadcast.");
        }
      } else if (currentMode?.value_json?.mode !== "TESTNET_DEMO" || currentMode?.value_json?.testnet_payouts !== true) {
        throw new Error("Testnet payouts were disabled before the transfer could be broadcast.");
      }
    }

    const amountRaw = usdtUnits(withdrawal.net_amount);
    if (!withdrawal.destination_address) {
      throw new Error("Withdrawal destination address is missing.");
    }

    const tron = new TronWeb({
      fullHost: chain,
      headers: TRONGRID_KEY ? { "TRON-PRO-API-KEY": TRONGRID_KEY } : undefined,
      privateKey: payoutKey,
    });
    const contract = await tron.contract().at(usdtContract);

    // Recheck the complete production gate immediately before network broadcast.
    // This closes the race where an operator locks production after the request is claimed
    // but before the transfer is submitted. Any failed gate exits through the safe refund path.
    if (mainnet) {
      const [{ data: finalModeRow, error: finalModeError },
        { data: finalNetworkRow, error: finalNetworkError },
        { data: finalProductionRow, error: finalProductionError },
        { data: finalRuntimeRow, error: finalRuntimeError }] = await Promise.all([
          admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle(),
          admin.from("platform_settings").select("value_json").eq("key", "deposit_rules").maybeSingle(),
          admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle(),
          admin.from("platform_settings").select("value_json").eq("key", "app_runtime").maybeSingle(),
        ]);
      if (finalModeError || finalNetworkError || finalProductionError || finalRuntimeError) {
        throw new Error("Unable to revalidate the production payout gate.");
      }
      const finalSystem = finalModeRow?.value_json || {};
      const finalNetworkConfig = finalNetworkRow?.value_json || {};
      const finalProduction = finalProductionRow?.value_json || {};
      const finalNetwork = String(finalNetworkConfig.network || "").toUpperCase();
      const finalRuntimeEnabled = finalRuntimeRow?.value_json?.enabled === true;
      const finalGateOpen =
        finalSystem.mode === "MAINNET" &&
        finalSystem.real_payouts === true &&
        finalSystem.production_go_live_approved === true &&
        finalNetwork === "TRON MAINNET" &&
        String(finalProduction.environment || "").toUpperCase() === "PRODUCTION" &&
        finalProduction.go_live_approved === true &&
        finalProduction.real_payouts_enabled === true &&
        finalProduction.payouts_locked === false &&
        finalRuntimeEnabled === true;
      if (!finalGateOpen) {
        throw new Error("Production payout gate was closed before broadcast.");
      }
    } else {
      const { data: stillEnabled, error: finalRuntimeError } = await admin.rpc("app_runtime_enabled");
      if (finalRuntimeError || stillEnabled !== true) {
        throw new Error("AegisPay is paused by Master Admin; payout was not broadcast.");
      }
    }

    let txid = "";
    if (ephemeralPayout) {
      // The one-time payout HD seed is separate from both deposit seeds. No private key is persisted or returned.
      const { data: nextIndexValue, error: indexError } = await admin.rpc("next_tron_withdrawal_payout_index");
      const derivationIndex = Number(nextIndexValue);
      if (indexError || !Number.isSafeInteger(derivationIndex) || derivationIndex < 1 || derivationIndex >= 2147483648) {
        throw new Error("WITHDRAWAL_PAYOUT_INDEX_UNAVAILABLE");
      }
      const senderIdentity = await deriveTronHdIdentity(selectedPayoutHdMnemonic, selectedPayoutHdPassphrase, derivationIndex);
      const sameNetworkDepositMnemonic = mainnet ? MAINNET_DEPOSIT_HD_MNEMONIC : SHASTA_HD_MNEMONIC;
      const otherNetworkDepositMnemonic = mainnet ? SHASTA_HD_MNEMONIC : MAINNET_DEPOSIT_HD_MNEMONIC;
      const sameNetworkDepositPassphrase = mainnet
        ? (Deno.env.get("TRON_MAINNET_CHILD_HD_PASSPHRASE") || Deno.env.get("TRON_HD_WALLET_PASSPHRASE") || "")
        : (Deno.env.get("TRON_SHASTA_CHILD_HD_PASSPHRASE") || Deno.env.get("TRON_TESTNET_HD_WALLET_PASSPHRASE") || "");
      const otherNetworkDepositPassphrase = mainnet
        ? (Deno.env.get("TRON_SHASTA_CHILD_HD_PASSPHRASE") || Deno.env.get("TRON_TESTNET_HD_WALLET_PASSPHRASE") || "")
        : (Deno.env.get("TRON_MAINNET_CHILD_HD_PASSPHRASE") || Deno.env.get("TRON_HD_WALLET_PASSPHRASE") || "");
      const depositRoot = await deriveTronHdIdentity(sameNetworkDepositMnemonic, sameNetworkDepositPassphrase, 0);
      const otherRoot = await deriveTronHdIdentity(otherNetworkDepositMnemonic, otherNetworkDepositPassphrase, 0);
      if (senderIdentity.rootFingerprint === depositRoot.rootFingerprint || senderIdentity.rootFingerprint === otherRoot.rootFingerprint) {
        throw new Error("WITHDRAWAL_PAYOUT_HD_ROOT_NOT_DISTINCT");
      }
      const { data: indexCollision, error: indexCollisionError } = await admin.from("withdrawal_payout_journal")
        .select("id").eq("derivation_index", derivationIndex).limit(1);
      const { data: addressCollision, error: addressCollisionError } = await admin.from("withdrawal_payout_journal")
        .select("id").eq("address", senderIdentity.address).limit(1);
      const { data: depositCollision, error: depositCollisionError } = await admin.from("deposit_wallets")
        .select("id").eq("network", network).eq("address", senderIdentity.address).limit(1);
      if (indexCollisionError || addressCollisionError || depositCollisionError ||
          (indexCollision || []).length || (addressCollision || []).length || (depositCollision || []).length) {
        throw new Error("WITHDRAWAL_PAYOUT_ADDRESS_COLLISION");
      }

      const treasuryTron = new TronWeb({
        fullHost: chain,
        headers: { "TRON-PRO-API-KEY": TRONGRID_KEY },
        privateKey: payoutKey,
      });
      const senderTron = new TronWeb({
        fullHost: chain,
        headers: { "TRON-PRO-API-KEY": TRONGRID_KEY },
        privateKey: senderIdentity.privateKey,
      });
      const treasuryContract = await treasuryTron.contract().at(usdtContract);
      const senderContract = await senderTron.contract().at(usdtContract);
      const currentTrx = Number(await senderTron.trx.getBalance(senderIdentity.address));
      const currentToken = BigInt(String(await senderContract.balanceOf(senderIdentity.address).call()));
      if (currentTrx !== 0 || currentToken !== 0n) throw new Error("WITHDRAWAL_PAYOUT_CHILD_ADDRESS_NOT_EMPTY");

      const { data: journalRow, error: journalInsertError } = await admin.from("withdrawal_payout_journal").insert({
        withdrawal_id: withdrawal.id,
        user_id: withdrawal.user_id,
        network,
        derivation_index: derivationIndex,
        address: senderIdentity.address,
        root_fingerprint: senderIdentity.rootFingerprint,
        destination_address: withdrawal.destination_address,
        net_amount_raw: amountRaw,
        status: "PREPARED",
        idempotency_key: "withdrawal:" + withdrawal.id,
      }).select("id").single();
      if (journalInsertError || !journalRow) throw new Error("WITHDRAWAL_PAYOUT_JOURNAL_CREATE_FAILED");
      payoutJournalStarted = true;

      // The temporary account must be activated and funded. Funding transactions are public
      // and can be linked back to the treasury; the customer's final USDT payout is sent by
      // this per-withdrawal sender address.
      await updateWithdrawalPayoutJournal(admin, withdrawal.id, { status: "ACTIVATION_SUBMITTED" });
      payoutMayHaveBeenBroadcast = true;
      const activationResult = await treasuryTron.trx.sendTrx(senderIdentity.address, 1_000_000);
      const activationTxid = safeTxid(activationResult);
      if (!/^[a-fA-F0-9]{64}$/.test(activationTxid)) throw new Error("WITHDRAWAL_PAYOUT_ACTIVATION_TXID_MISSING");
      await updateWithdrawalPayoutJournal(admin, withdrawal.id, { trx_activation_txid: activationTxid });
      await waitForTransactionInfo(treasuryTron, activationTxid);
      if (Number(await senderTron.trx.getBalance(senderIdentity.address)) <= 0) throw new Error("WITHDRAWAL_PAYOUT_ACTIVATION_NOT_VISIBLE");
      await updateWithdrawalPayoutJournal(admin, withdrawal.id, { status: "ACTIVATED", activated_at: new Date().toISOString() });

      await updateWithdrawalPayoutJournal(admin, withdrawal.id, { status: "USDT_FUNDING_SUBMITTED" });
      const usdtFundingResult = await treasuryContract.transfer(senderIdentity.address, amountRaw).send({
        feeLimit: 100_000_000, callValue: 0, shouldPollResponse: true,
      });
      const usdtFundingTxid = safeTxid(usdtFundingResult);
      if (!/^[a-fA-F0-9]{64}$/.test(usdtFundingTxid)) throw new Error("WITHDRAWAL_PAYOUT_FUNDING_TXID_MISSING");
      await updateWithdrawalPayoutJournal(admin, withdrawal.id, { usdt_funding_txid: usdtFundingTxid });
      const usdtFundingInfo = await waitForTransactionInfo(treasuryTron, usdtFundingTxid);
      if (!hasExpectedUsdtTransfer(usdtFundingInfo, usdtContract, configuredTreasury, senderIdentity.address, amountRaw)) throw new Error("WITHDRAWAL_PAYOUT_FUNDING_RECEIPT_MISMATCH");
      const fundedTokenBalance = BigInt(String(await senderContract.balanceOf(senderIdentity.address).call()));
      if (fundedTokenBalance !== BigInt(amountRaw)) throw new Error("WITHDRAWAL_PAYOUT_FUNDING_BALANCE_MISMATCH");
      await updateWithdrawalPayoutJournal(admin, withdrawal.id, { status: "USDT_FUNDED", funded_at: new Date().toISOString() });

      const energyEstimate = await estimateUsdtTransferEnergy(chain, usdtContract, senderIdentity.address, withdrawal.destination_address, amountRaw);
      const feeReserve = estimatePayoutFeeReserveSun(energyEstimate.energyRequired, energyEstimate.energyFeeSun, selectedPayoutMaxFeeTrx);
      if (!feeReserve.ok) throw new Error(feeReserve.code);
      await updateWithdrawalPayoutJournal(admin, withdrawal.id, {
        estimated_energy: feeReserve.estimatedEnergy,
        estimated_fee_sun: feeReserve.reserveSun.toString(),
      });

      const currentSun = BigInt(String(await senderTron.trx.getBalance(senderIdentity.address)));
      if (currentSun < feeReserve.reserveSun) {
        const topupSun = feeReserve.reserveSun - currentSun;
        await updateWithdrawalPayoutJournal(admin, withdrawal.id, { status: "TRX_FEE_TOPUP_SUBMITTED" });
        const topupResult = await treasuryTron.trx.sendTrx(senderIdentity.address, Number(topupSun));
        const topupTxid = safeTxid(topupResult);
        if (!/^[a-fA-F0-9]{64}$/.test(topupTxid)) throw new Error("WITHDRAWAL_PAYOUT_FEE_TXID_MISSING");
        await updateWithdrawalPayoutJournal(admin, withdrawal.id, { trx_fee_topup_txid: topupTxid });
        await waitForTransactionInfo(treasuryTron, topupTxid);
        if (BigInt(String(await senderTron.trx.getBalance(senderIdentity.address))) < feeReserve.reserveSun) throw new Error("WITHDRAWAL_PAYOUT_FEE_RESERVE_NOT_VISIBLE");
      }
      await updateWithdrawalPayoutJournal(admin, withdrawal.id, { status: "FEE_READY" });

      if (ephemeralPayout && mainnet) {
        const { data: immediateModeRow, error: immediateModeError } = await admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle();
        const { data: immediateProdRow, error: immediateProdError } = await admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle();
        const { data: immediateNetworkRow, error: immediateNetworkError } = await admin.from("platform_settings").select("value_json").eq("key", "deposit_rules").maybeSingle();
        const { data: immediateRuntime, error: immediateRuntimeError } = await admin.rpc("app_runtime_enabled");
        if (immediateModeError || immediateProdError || immediateNetworkError || immediateRuntimeError) {
          throw new Error("Unable to perform final payout gate revalidation.");
        }
        const modeNow = immediateModeRow?.value_json || {};
        const prodNow = immediateProdRow?.value_json || {};
        const networkNow = immediateNetworkRow?.value_json || {};
        if (modeNow.mode !== "MAINNET" || modeNow.real_payouts !== true ||
            modeNow.production_go_live_approved !== true ||
            String(networkNow.network || "").toUpperCase() !== "TRON MAINNET" ||
            String(prodNow.environment || "").toUpperCase() !== "PRODUCTION" ||
            prodNow.go_live_approved !== true || prodNow.real_payouts_enabled !== true ||
            prodNow.payouts_locked !== false || immediateRuntime !== true) {
          throw new Error("Production payout gate closed immediately before final broadcast.");
        }
      }
      // Revalidate isolated Shasta configuration immediately before the customer's USDT broadcast.
      // Mainnet remains locked; this gate is strictly limited to the Shasta test path.
      if (isolatedShasta) {
        const finalShastaEnabled = Deno.env.get("TRON_SHASTA_TEST_PAYOUTS_ENABLED") === "true";
        const [
          { data: finalShastaModeRow, error: finalShastaModeError },
          { data: finalShastaRulesRow, error: finalShastaRulesError },
          { data: finalShastaProductionRow, error: finalShastaProductionError },
          { data: finalShastaRuntime, error: finalShastaRuntimeError },
          finalShastaTestUserAllowed,
          finalShastaWithdrawalAllowed,
          finalValidatedShastaRules,
        ] = await Promise.all([
          admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle(),
          admin.from("platform_settings").select("value_json").eq("key", "shasta_testnet_rules").maybeSingle(),
          admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle(),
          admin.rpc("app_runtime_enabled"),
          isAllowlistedShastaTestUser(admin, String(withdrawal.user_id || ""), finalShastaEnabled),
          isAllowlistedShastaTestWithdrawal(
            admin,
            String(withdrawal.id || withdrawalId || ""),
            finalShastaEnabled,
            String(withdrawal.destination_address || ""),
          ),
          loadShastaTestRules(admin, finalShastaEnabled),
        ]);
        const finalShastaMode = finalShastaModeRow?.value_json || {};
        const finalShastaRules = finalShastaRulesRow?.value_json || {};
        const finalShastaProduction = finalShastaProductionRow?.value_json || {};
        if (
          finalShastaModeError || finalShastaRulesError || finalShastaProductionError || finalShastaRuntimeError ||
          !finalShastaEnabled ||
          !finalShastaTestUserAllowed ||
          !finalShastaWithdrawalAllowed ||
          !finalValidatedShastaRules ||
          String(SHASTA_WITHDRAWAL_PAYOUT_MODE || "").trim().toUpperCase() !== "EPHEMERAL_HD" ||
          finalShastaMode.mode !== "MAINNET" ||
          String(finalShastaRules.network || "").toUpperCase() !== "TRON TESTNET" ||
          String(finalShastaRules.token_contract || "") !== SHASTA_USDT ||
          String(finalShastaRules.receiving_address || "").trim() !== configuredTreasury ||
          finalValidatedShastaRules.token_contract !== SHASTA_USDT ||
          String(finalValidatedShastaRules.receiving_address || "").trim() !== configuredTreasury ||
          finalShastaRuntime !== true ||
          finalShastaProduction.payouts_locked !== true ||
          finalShastaProduction.real_payouts_enabled !== false ||
          finalShastaProduction.live_deposits_enabled !== false
        ) {
          throw new Error("Isolated Shasta payout gate or allowlist changed/could not be verified immediately before broadcast.");
        }
      }

      await updateWithdrawalPayoutJournal(admin, withdrawal.id, { status: "PAYOUT_SUBMITTED", payout_submitted_at: new Date().toISOString() });
      const payoutTxid = safeTxid(await senderContract.transfer(withdrawal.destination_address, amountRaw).send({
        feeLimit: Math.floor(selectedPayoutMaxFeeTrx * 1_000_000), callValue: 0, shouldPollResponse: true,
      }));
      if (!/^[a-fA-F0-9]{64}$/.test(payoutTxid)) throw new Error("WITHDRAWAL_PAYOUT_TXID_MISSING");
      await updateWithdrawalPayoutJournal(admin, withdrawal.id, { payout_txid: payoutTxid });
      const payoutInfo = await waitForTransactionInfo(senderTron, payoutTxid);
      if (!hasExpectedUsdtTransfer(payoutInfo, usdtContract, senderIdentity.address, withdrawal.destination_address, amountRaw)) throw new Error("WITHDRAWAL_PAYOUT_RECEIPT_MISMATCH");
      txid = payoutTxid;
    } else {
      // Testnet/demo payout behavior remains unchanged.
      payoutMayHaveBeenBroadcast = true;
      txid = safeTxid(await contract.transfer(withdrawal.destination_address, amountRaw).send({
        feeLimit: 100_000_000,
        callValue: 0,
        shouldPollResponse: true,
      }));
    }
    if (!txid || txid === "undefined" || txid === "null") {
      throw new Error("TRON returned no transaction id.");
    }

    const { data: paid, error: persistError } = await admin
      .from("withdrawal_requests")
      .update({
        status: "PAID",
        payout_txid: txid,
        payout_completed_at: new Date().toISOString(),
        payout_error: null,
      })
      .eq("id", withdrawal.id)
      .eq("status", "PROCESSING")
      .select("id")
      .maybeSingle();

    if (persistError || !paid) {
      await admin.from("withdrawal_requests")
        .update({ payout_error: "TRON transaction " + txid + " was submitted; payout status needs manual reconciliation." })
        .eq("id", withdrawal.id)
        .eq("status", "PROCESSING");
      return json({
        status: "RECONCILIATION_REQUIRED",
        txid,
        error: "The transfer was submitted, but its status could not be saved. Do not retry before reconciliation.",
      }, 202);
    }

    if (ephemeralPayout && payoutJournalStarted) {
      try {
        await updateWithdrawalPayoutJournal(admin, withdrawal.id, { status: "PAID", payout_txid: txid, paid_at: new Date().toISOString(), last_error_code: null });
      } catch {
        await admin.from("withdrawal_payout_journal").update({
          status: "RECONCILIATION_REQUIRED",
          last_error_code: "PAYOUT_CONFIRMED_JOURNAL_FINALIZE_FAILED",
          updated_at: new Date().toISOString(),
        }).eq("withdrawal_id", withdrawal.id);
        return json({ status: "PAID", txid, journalReconciliationRequired: true }, 202);
      }
    }

    const { error: auditError } = await admin.from("audit_events").insert({
      actor_user_id: profile.id,
      target_user_id: withdrawal.user_id,
      event_type: "WITHDRAWAL_PAID",
      description: ephemeralPayout ? "TRON USDT payout sent via per-withdrawal HD sender wallet" : "TRON USDT payout submitted by payout service",
      reference_id: withdrawal.id,
    });

    return json({ status: "PAID", txid, auditLogged: !auditError });
  } catch (error) {
    const detail = ephemeralPayout ? "Per-withdrawal payout stage failed; reconcile the journal before any retry." : errorMessage(error);
    if (admin && withdrawalId && ephemeralPayout && payoutJournalStarted) {
      await admin.from("withdrawal_payout_journal").update({
        status: payoutMayHaveBeenBroadcast ? "RECONCILIATION_REQUIRED" : "FAILED_BEFORE_BROADCAST",
        last_error_code: payoutMayHaveBeenBroadcast ? "PAYOUT_STAGE_REQUIRES_RECONCILIATION" : "PAYOUT_FAILED_BEFORE_BROADCAST",
        updated_at: new Date().toISOString(),
      }).eq("withdrawal_id", withdrawalId);
    }
    if (admin && withdrawalId) {
      if (payoutMayHaveBeenBroadcast) {
        await admin.from("withdrawal_requests")
          .update({ payout_error: "Payout outcome is unknown; keep PROCESSING until chain reconciliation. " + detail })
          .eq("id", withdrawalId)
          .eq("status", "PROCESSING");
      } else if (claimedWithdrawal) {
        const { data: restored, error: restoreError } = await admin.rpc("fail_unbroadcast_withdrawal", {
          p_request_id: withdrawalId,
          p_error: "Payout was not broadcast. " + detail,
        });
        if (restoreError || restored !== true) {
          await admin.from("withdrawal_requests")
            .update({ payout_error: "Payout was not broadcast, but the balance refund needs manual reconciliation. " + detail })
            .eq("id", withdrawalId)
            .eq("status", "PROCESSING");
        }
      } else {
        await admin.from("withdrawal_requests")
          .update({ payout_error: "Payout was not submitted." })
          .eq("id", withdrawalId)
          .eq("status", "APPROVED");
      }
    }
    if (detail.includes("AegisPay is paused by Master Admin")) {
      return json({
        error: "AegisPay is paused by Master Admin.",
        balanceRestored: Boolean(claimedWithdrawal && !payoutMayHaveBeenBroadcast),
      }, 423);
    }
    return json({
      error: payoutMayHaveBeenBroadcast
        ? "Payout outcome is unknown; keep the withdrawal locked for manual reconciliation."
        : claimedWithdrawal
        ? "Payout failed before broadcast. The balance was restored or flagged for manual refund reconciliation."
        : "Payout request failed before broadcast.",
      balanceRestored: Boolean(claimedWithdrawal && !payoutMayHaveBeenBroadcast),
      detail,
    }, payoutMayHaveBeenBroadcast || claimedWithdrawal ? 202 : 502);
  }
});

