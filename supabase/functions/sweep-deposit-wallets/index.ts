import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TronWeb } from "npm:tronweb@6.0.4";
import { deriveTronHdIdentity } from "../_shared/tron-hd-wallet.ts";

import { buildSweepIdempotencyKey, classifySweepAction, classifySweepReceipt, estimateSweepBandwidth, estimateSweepEnergyRequirement, estimateSweepFeeLimitSun, getAvailableBandwidth, hasEnoughSweepResources, isSuccessfulSweepSimulation } from "../_shared/tron-sweep.ts";
import { loadShastaTestRules, shastaMnemonicsAreDistinct } from "../_shared/shasta-test-mode.ts";
import { validateTargetedDepositSweep } from "../_shared/targeted-sweep-policy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TESTNET_SWEEP_ENABLED = Deno.env.get("AEGIS_ENABLE_TESTNET_SWEEP") === "true";
const SHASTA_TEST_MODE_ENABLED = Deno.env.get("AEGIS_SHASTA_TEST_MODE") === "true";
const HD_MNEMONIC = Deno.env.get("TRON_SHASTA_CHILD_HD_MNEMONIC") || Deno.env.get("TRON_TESTNET_HD_WALLET_MNEMONIC") || "";
const MAINNET_HD_MNEMONIC = Deno.env.get("TRON_MAINNET_CHILD_HD_MNEMONIC") || Deno.env.get("TRON_HD_WALLET_MNEMONIC") || "";
const HD_PASSPHRASE = Deno.env.get("TRON_SHASTA_CHILD_HD_PASSPHRASE") || Deno.env.get("TRON_TESTNET_HD_WALLET_PASSPHRASE") || "";
const TESTNET_PAYOUT_KEY = Deno.env.get("TRON_SHASTA_TREASURY_PRIVATE_KEY") || Deno.env.get("TRON_TESTNET_PAYOUT_PRIVATE_KEY") || "";
const TRONGRID_KEY = Deno.env.get("TRONGRID_API_KEY") || "";
const NETWORK = "TRON TESTNET";
const TOKEN = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const HOST = "https://api.shasta.trongrid.io";
const MAX_WALLETS_PER_RUN = 1;
const MAX_INBOUND_TXS = 200;
const FEE_LIMIT_SUN = 100_000_000;
const MIN_TRX_FOR_SWEEP_SUN = 120_000_000;
const MIN_ENERGY_FOR_SWEEP = 100_000;
const MIN_BANDWIDTH_FOR_SWEEP = 1_000;
const MIN_TRX_WITH_ENERGY_SUN = 1_000_000;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-aegis-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
type Admin = ReturnType<typeof createClient<any>>;
type WalletRow = {
  id: string; user_id: string; address: string; derivation_index: number;
  wallet_root_fingerprint: string; token_contract: string; network: string;
};
type SweepRow = {
  id: string; deposit_wallet_id: string; network: string; token_contract: string;
  treasury_address: string; amount_raw: string; txid: string | null;
  signed_transaction: any; transaction_expiration_ms: number | null;
  status: string; idempotency_key: string; target_deposit_txid?: string | null; failure_code?: string | null;
};
type IncomingTransfer = { txid: string; rawAmount: string; blockTimestamp: number };
type VerifiedSource = { id: string; txid: string; raw_amount?: string | null; verification_source: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function validAddress(value: string) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
}
function validTxid(value: string) {
  return /^[a-fA-F0-9]{64}$/.test(value);
}
function newTron(privateKey: string) {
  return new TronWeb({
    fullHost: HOST,
    privateKey,
    headers: TRONGRID_KEY ? { "TRON-PRO-API-KEY": TRONGRID_KEY } : {},
  });
}
function asRawBigInt(value: unknown): bigint {
  try { return BigInt(String(value ?? "0")); } catch { return 0n; }
}
function errorCode(error: unknown): string {
  const text = String((error as Error)?.message || error || "").toLowerCase();
  if (text.includes("energy") || text.includes("bandwidth") || text.includes("fee")) return "RESOURCE_OR_FEE_ERROR";
  if (text.includes("timeout") || text.includes("network") || text.includes("fetch")) return "PROVIDER_UNAVAILABLE";
  return "SWEEP_PROCESSING_ERROR";
}
async function updateSweep(admin: Admin, row: SweepRow, patch: Record<string, unknown>, expected: string[]) {
  const { data, error } = await admin.from("deposit_wallet_sweeps").update(patch)
    .eq("id", row.id).in("status", expected).select("*").maybeSingle();
  if (error) throw new Error("SWEEP_JOURNAL_UPDATE_FAILED");
  if (data) return data as SweepRow;
  const { data: current, error: readError } = await admin.from("deposit_wallet_sweeps")
    .select("*").eq("id", row.id).maybeSingle();
  if (readError || !current) throw new Error("SWEEP_JOURNAL_STATE_UNAVAILABLE");
  return current as SweepRow;
}
async function markReview(admin: Admin, row: SweepRow, failureCode: string) {
  const { error } = await admin.from("deposit_wallet_sweeps")
    .update({ status: "FAILED_REVIEW", failure_code: failureCode, last_checked_at: new Date().toISOString() })
    .eq("id", row.id).in("status", ["PREPARED", "SIGNED", "BROADCAST"]);
  if (error) return { walletId: row.deposit_wallet_id, sweepId: row.id, status: "JOURNAL_UPDATE_FAILED" };
  return { walletId: row.deposit_wallet_id, sweepId: row.id, status: "MANUAL_REVIEW_REQUIRED", code: failureCode };
}

async function getTokenBalance(client: any, address: string): Promise<string> {
  const contract = await client.contract().at(TOKEN);
  const raw = asRawBigInt(await contract.balanceOf(address).call());
  return raw.toString();
}
async function getIncomingTransfers(address: string): Promise<IncomingTransfer[]> {
  const url = new URL(HOST + "/v1/accounts/" + encodeURIComponent(address) + "/transactions/trc20");
  url.searchParams.set("only_confirmed", "true");
  url.searchParams.set("only_to", "true");
  url.searchParams.set("limit", String(MAX_INBOUND_TXS));
  url.searchParams.set("order_by", "block_timestamp,desc");
  url.searchParams.set("contract_address", TOKEN);
  const headers: Record<string, string> = { accept: "application/json" };
  if (TRONGRID_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_KEY;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("TRONGRID_INBOUND_QUERY_FAILED");
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (rows.length >= MAX_INBOUND_TXS) throw new Error("INBOUND_HISTORY_LIMIT_REACHED");
  const parsed: IncomingTransfer[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const txid = String(row?.transaction_id || "").toLowerCase();
    const to = String(row?.to || "");
    const contract = String(row?.token_info?.address || row?.contract_address || "");
    const rawAmount = String(row?.value || "0");
    const timestamp = Number(row?.block_timestamp || 0);
    if (!validTxid(txid) || to !== address || contract !== TOKEN || row?.success === false ||
      !Number.isSafeInteger(timestamp) || timestamp <= 0 || asRawBigInt(rawAmount) <= 0n) {
      throw new Error("INBOUND_TRANSFER_DATA_INVALID");
    }
    if (seen.has(txid)) continue;
    seen.add(txid);
    parsed.push({ txid, rawAmount: asRawBigInt(rawAmount).toString(), blockTimestamp: timestamp });
  }
  return parsed.sort((a, b) => b.blockTimestamp - a.blockTimestamp);
}
async function getVerifiedSources(admin: Admin, walletId: string): Promise<Map<string, VerifiedSource>> {
  const { data, error } = await admin.from("deposit_submissions")
    .select("id,txid,raw_amount,verification_source").eq("deposit_wallet_id", walletId).eq("status", "VERIFIED")
    .in("verification_source", ["TronGrid", "TronGrid Monitor"]).limit(1000);
  if (error) throw new Error("VERIFIED_DEPOSIT_LOOKUP_FAILED");
  const map = new Map<string, VerifiedSource>();
  for (const row of data || []) {
    const txid = String(row.txid || "").toLowerCase();
    const verificationSource = String(row.verification_source || "");
    if (validTxid(txid) && ["TronGrid", "TronGrid Monitor"].includes(verificationSource)) {
      map.set(txid, {
        id: String(row.id),
        txid,
        raw_amount: row.raw_amount == null ? null : String(row.raw_amount),
        verification_source: verificationSource,
      });
    }
  }
  return map;
}
async function getSafeSnapshot(admin: Admin, client: any, wallet: WalletRow) {
  const beforeBalance = await getTokenBalance(client, wallet.address);
  if (BigInt(beforeBalance) <= 0n) return { ok: true as const, empty: true as const, balanceRaw: "0", amountRaw: "0", targetTxid: null as string | null, transfers: [], sources: new Map<string, VerifiedSource>() };
  const transfers = await getIncomingTransfers(wallet.address);
  if (!transfers.length) throw new Error("TOKEN_BALANCE_WITHOUT_CONFIRMED_INBOUND_HISTORY");
  const sources = await getVerifiedSources(admin, wallet.id);
  const unmatched = transfers.filter((item) => {
    const source = sources.get(item.txid);
    if (!source || !source.raw_amount) return true;
    return asRawBigInt(source.raw_amount) !== asRawBigInt(item.rawAmount);
  });
  if (unmatched.length) throw new Error("UNVERIFIED_OR_AMOUNT_MISMATCHED_INBOUND_TRANSFER_PRESENT");
  const sourceIds = [...new Set(transfers.map((item) => sources.get(item.txid)!.id))];
  const { data: previousItems, error: previousItemsError } = await admin.from("deposit_wallet_sweep_items")
    .select("sweep_id,deposit_submission_id").in("deposit_submission_id", sourceIds).limit(5000);
  if (previousItemsError) throw new Error("PRIOR_SWEEP_ITEMS_LOOKUP_FAILED");
  const previousSweepIds = [...new Set((previousItems || []).map((item: any) => String(item.sweep_id || "")))].filter(Boolean);
  const confirmedSweepIds = new Set<string>();
  if (previousSweepIds.length) {
    const { data: previousSweeps, error: previousSweepsError } = await admin.from("deposit_wallet_sweeps")
      .select("id,status").in("id", previousSweepIds).limit(5000);
    if (previousSweepsError) throw new Error("PRIOR_SWEEP_STATUS_LOOKUP_FAILED");
    for (const sweep of previousSweeps || []) {
      if (String(sweep.status) === "CONFIRMED") confirmedSweepIds.add(String(sweep.id));
    }
  }
  const alreadySweptSourceIds = new Set<string>();
  for (const item of previousItems || []) {
    if (confirmedSweepIds.has(String(item.sweep_id))) alreadySweptSourceIds.add(String(item.deposit_submission_id));
  }
  const unsweptTransfers = transfers.filter((item) => !alreadySweptSourceIds.has(sources.get(item.txid)!.id));
  const expectedRaw = unsweptTransfers.reduce((total, item) => total + asRawBigInt(item.rawAmount), 0n);
  if (expectedRaw !== BigInt(beforeBalance)) throw new Error("TOKEN_BALANCE_DOES_NOT_MATCH_UNSWEPT_VERIFIED_DEPOSITS");
  if (!unsweptTransfers.length) throw new Error("TOKEN_BALANCE_HAS_NO_UNSWEPT_VERIFIED_DEPOSITS");
  const afterBalance = await getTokenBalance(client, wallet.address);
  if (beforeBalance !== afterBalance) throw new Error("BALANCE_CHANGED_DURING_SNAPSHOT");
  return { ok: true as const, empty: false as const, balanceRaw: afterBalance, amountRaw: afterBalance, targetTxid: null as string | null, transfers: unsweptTransfers, sources };
}

async function getTargetedSafeSnapshot(
  admin: Admin,
  client: any,
  wallet: WalletRow,
  targetTxidValue: string,
  currentSweepId?: string,
) {
  const targetTxid = String(targetTxidValue || "").trim().toLowerCase();
  if (!validTxid(targetTxid)) throw new Error("TARGET_TXID_INVALID");

  const beforeBalance = await getTokenBalance(client, wallet.address);
  const { data: source, error: sourceError } = await admin.from("deposit_submissions")
    .select("id,user_id,deposit_wallet_id,txid,status,raw_amount,verification_source,network,token_contract,receiving_address,sender_address")
    .eq("deposit_wallet_id", wallet.id)
    .eq("user_id", wallet.user_id)
    .eq("txid", targetTxid)
    .maybeSingle();
  if (sourceError) throw new Error("TARGET_VERIFIED_DEPOSIT_LOOKUP_FAILED");
  if (!source) throw new Error("TARGET_VERIFIED_DEPOSIT_NOT_FOUND");

  const url = new URL(HOST + "/v1/accounts/" + encodeURIComponent(wallet.address) + "/transactions/trc20");
  url.searchParams.set("only_confirmed", "true");
  url.searchParams.set("only_to", "true");
  url.searchParams.set("limit", String(MAX_INBOUND_TXS));
  url.searchParams.set("order_by", "block_timestamp,desc");
  url.searchParams.set("contract_address", TOKEN);
  const headers: Record<string, string> = { accept: "application/json" };
  if (TRONGRID_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_KEY;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("TARGET_TRONGRID_INBOUND_QUERY_FAILED");
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (rows.length >= MAX_INBOUND_TXS) throw new Error("INBOUND_HISTORY_LIMIT_REACHED");

  const matchingTransfers = rows
    .filter((row: any) => String(row?.transaction_id || "").toLowerCase() === targetTxid)
    .map((row: any) => ({
      txid: String(row?.transaction_id || "").toLowerCase(),
      rawAmount: String(row?.value || "0"),
      from: String(row?.from || ""),
      to: String(row?.to || ""),
      contract: String(row?.token_info?.address || row?.contract_address || ""),
      success: row?.success === false ? false : true,
      decimals: Number(row?.token_info?.decimals),
      type: String(row?.type || ""),
      blockTimestamp: Number(row?.block_timestamp || 0),
    }));

  const { data: previousItems, error: previousItemsError } = await admin.from("deposit_wallet_sweep_items")
    .select("sweep_id").eq("deposit_submission_id", String(source.id)).limit(100);
  if (previousItemsError) throw new Error("TARGET_PRIOR_SWEEP_ITEMS_LOOKUP_FAILED");
  if ((previousItems || []).length >= 100) throw new Error("TARGET_PRIOR_SWEEP_HISTORY_LIMIT_REACHED");
  const previousSweepIds = [...new Set((previousItems || [])
    .map((item: any) => String(item.sweep_id || ""))).filter(Boolean)];
  let previousSweeps: any[] = [];
  if (previousSweepIds.length) {
    const { data, error } = await admin.from("deposit_wallet_sweeps")
      .select("id,status").in("id", previousSweepIds).limit(100);
    if (error) throw new Error("TARGET_PRIOR_SWEEP_STATUS_LOOKUP_FAILED");
    previousSweeps = data || [];
    if (previousSweeps.length !== previousSweepIds.length) throw new Error("TARGET_PRIOR_SWEEP_STATUS_INCOMPLETE");
  }
  const otherPreviousSweeps = previousSweeps.filter((row) => String(row.id) !== String(currentSweepId || ""));
  const alreadySwept = otherPreviousSweeps.some((row) => String(row.status).toUpperCase() === "CONFIRMED");
  const pendingSweep = otherPreviousSweeps.some((row) =>
    ["PREPARED", "SIGNED", "BROADCAST", "FAILED_REVIEW"].includes(String(row.status).toUpperCase())
  );

  const validation = validateTargetedDepositSweep({
    walletId: wallet.id,
    walletAddress: wallet.address,
    network: wallet.network,
    tokenContract: wallet.token_contract,
    targetTxid,
    balanceRaw: beforeBalance,
    source: {
      id: String(source.id),
      txid: String(source.txid || ""),
      status: String(source.status || ""),
      rawAmount: String(source.raw_amount || ""),
      verificationSource: String(source.verification_source || ""),
      walletId: String(source.deposit_wallet_id || ""),
      network: String(source.network || ""),
      tokenContract: String(source.token_contract || ""),
      receivingAddress: String(source.receiving_address || ""),
      senderAddress: String(source.sender_address || ""),
    },
    transfers: matchingTransfers,
    alreadySwept,
    pendingSweep,
  });
  if (!validation.ok) throw new Error(validation.code);

  const afterBalance = await getTokenBalance(client, wallet.address);
  if (beforeBalance !== afterBalance) throw new Error("BALANCE_CHANGED_DURING_TARGETED_SNAPSHOT");
  const verifiedSource: VerifiedSource = {
    id: String(source.id),
    txid: targetTxid,
    raw_amount: validation.amountRaw,
    verification_source: String(source.verification_source),
  };
  return {
    ok: true as const,
    empty: false as const,
    balanceRaw: afterBalance,
    amountRaw: validation.amountRaw,
    targetTxid: validation.targetTxid,
    transfers: [{
      txid: validation.targetTxid,
      rawAmount: validation.amountRaw,
      blockTimestamp: matchingTransfers[0].blockTimestamp,
    }],
    sources: new Map<string, VerifiedSource>([[validation.targetTxid, verifiedSource]]),
  };
}

async function estimateUsdtTransferEnergy(senderAddress: string, destinationAddress: string, amountRaw: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", accept: "application/json" };
  if (TRONGRID_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_KEY;
  const amount = BigInt(amountRaw);
  if (amount <= 0n || amount >= (1n << 256n)) throw new Error("SWEEP_ENERGY_ESTIMATE_AMOUNT_INVALID");
  const destinationHex = TronWeb.address.toHex(destinationAddress).replace(/^41/i, "");
  const requestBody = {
    owner_address: TronWeb.address.toHex(senderAddress),
    contract_address: TronWeb.address.toHex(TOKEN),
    function_selector: "transfer(address,uint256)",
    parameter: destinationHex.padStart(64, "0") + amount.toString(16).padStart(64, "0"),
    visible: false,
  };
  let estimatedEnergy = 0;
  try {
    const response = await fetch(HOST + "/wallet/estimateenergy", {
      method: "POST", headers, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const payload = await response.json().catch(() => null);
      const value = Number(payload?.energy_required);
      if (payload?.result?.result === true && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000) {
        estimatedEnergy = value;
      }
    }
  } catch { /* Fall back to the generally available constant-contract simulation. */ }
  if (!estimatedEnergy) {
    try {
      const response = await fetch(HOST + "/wallet/triggerconstantcontract", {
        method: "POST", headers, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        const value = Number(payload?.energy_used);
        if (isSuccessfulSweepSimulation(payload) && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000) {
          estimatedEnergy = value;
        }
      }
    } catch { /* No static estimate is used when node simulation is unavailable. */ }
  }
  if (!estimatedEnergy) throw new Error("SWEEP_ENERGY_SIMULATION_UNAVAILABLE");
  const paramsResponse = await fetch(HOST + "/wallet/getchainparameters", {
    method: "POST", headers, body: "{}", signal: AbortSignal.timeout(10_000),
  });
  if (!paramsResponse.ok) throw new Error("SWEEP_CHAIN_FEE_PARAMETERS_UNAVAILABLE");
  const params = await paramsResponse.json().catch(() => null);
  const entries = Array.isArray(params?.chainParameter) ? params.chainParameter : [];
  const energyFeeSun = Number(entries.find((entry: any) => entry?.key === "getEnergyFee")?.value);
  if (!Number.isSafeInteger(energyFeeSun) || energyFeeSun <= 0 || energyFeeSun > 1_000_000) {
    throw new Error("SWEEP_CHAIN_ENERGY_FEE_INVALID");
  }
  const requiredEnergy = Math.max(MIN_ENERGY_FOR_SWEEP, estimateSweepEnergyRequirement(estimatedEnergy, 1.3));
  const feeLimitSun = estimateSweepFeeLimitSun(estimatedEnergy, energyFeeSun, FEE_LIMIT_SUN, 1.35, 2_000_000);
  if (!requiredEnergy || !feeLimitSun) throw new Error("SWEEP_ENERGY_FEE_LIMIT_EXCEEDED");
  return { estimatedEnergy, requiredEnergy, energyFeeSun, feeLimitSun };
}

async function hasSufficientResources(client: any, address: string, requiredEnergy: number, requiredBandwidth: number, feeLimitSun: number) {
  if (!Number.isSafeInteger(requiredEnergy) || requiredEnergy <= 0 ||
      !Number.isSafeInteger(requiredBandwidth) || requiredBandwidth <= 0 ||
      !Number.isSafeInteger(feeLimitSun) || feeLimitSun < 3_000_000 || feeLimitSun > FEE_LIMIT_SUN) {
    return { ok: false, code: "SWEEP_RESOURCE_REQUIREMENT_INVALID" };
  }
  const [trxBalance, resources] = await Promise.all([
    client.trx.getBalance(address),
    client.trx.getAccountResources(address),
  ]);
  const balance = Number(trxBalance);
  if (!Number.isFinite(balance) || balance < 0) return { ok: false, code: "TRX_BALANCE_UNAVAILABLE" };
  const energy = Math.max(0, Number(resources?.EnergyLimit || 0) - Number(resources?.EnergyUsed || 0));
  const bandwidth = getAvailableBandwidth(
    Number(resources?.NetLimit ?? 0),
    Number(resources?.NetUsed ?? 0),
    Number(resources?.freeNetLimit ?? 0),
    Number(resources?.freeNetUsed ?? 0),
  );
  if (hasEnoughSweepResources(balance, energy, bandwidth, MIN_TRX_FOR_SWEEP_SUN, requiredEnergy, requiredBandwidth, MIN_TRX_WITH_ENERGY_SUN)) {
    return { ok: true, code: balance >= MIN_TRX_FOR_SWEEP_SUN ? "TRX_FEE_RESERVE_READY" : "ESTIMATED_ENERGY_AND_BANDWIDTH_READY" };
  }
  return { ok: false, code: "NEEDS_ESTIMATED_TRX_ENERGY_AND_BANDWIDTH" };
}

async function markConfirmed(admin: Admin, row: SweepRow, txid: string) {
  const updated = await updateSweep(admin, row, {
    status: "CONFIRMED", txid, confirmed_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(), failure_code: null,
  }, ["SIGNED", "BROADCAST"]);
  return { walletId: row.deposit_wallet_id, sweepId: row.id, status: updated.status === "CONFIRMED" ? "SWEPT_CONFIRMED" : updated.status, txid };
}

async function getTransactionInfoForReconciliation(client: any, txid: string): Promise<any> {
  let info: any = null;
  try { info = await client.trx.getTransactionInfo(txid); } catch { /* Use the explicit Shasta HTTP fallback below. */ }
  if (info && String(info.id || "").toLowerCase() === txid.toLowerCase()
    && info.receipt && Array.isArray(info.log)) return info;
  try {
    const headers: Record<string, string> = { accept: "application/json", "Content-Type": "application/json" };
    if (TRONGRID_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_KEY;
    const response = await fetch(HOST + "/wallet/gettransactioninfobyid", {
      method: "POST",
      headers,
      body: JSON.stringify({ value: txid }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const fallback = await response.json();
      if (fallback && String(fallback.id || "").toLowerCase() === txid.toLowerCase()) return fallback;
    }
  } catch { /* Fall through to the safe PENDING/expiry handling below. */ }
  return info;
}

async function processSavedTransaction(admin: Admin, client: any, row: SweepRow, treasury: string) {
  const decision = classifySweepAction(row);
  if (decision === "ALREADY_CONFIRMED") return { walletId: row.deposit_wallet_id, sweepId: row.id, status: "ALREADY_CONFIRMED", txid: row.txid };
  if (decision === "MANUAL_REVIEW") return markReview(admin, row, "SAVED_TRANSACTION_INVALID_OR_EXPIRED");
  const txid = String(row.txid);
  const signedTx = row.signed_transaction;
  const info = await getTransactionInfoForReconciliation(client, txid);
  const receiptState = classifySweepReceipt(
    info,
    txid,
    TronWeb.address.toHex(TOKEN),
    TronWeb.address.toHex(treasury),
    String(row.amount_raw),
  );
  if (receiptState === "CONFIRMED") return await markConfirmed(admin, row, txid);
  if (receiptState === "FAILED" || receiptState === "MISMATCH") {
    return markReview(admin, row, receiptState === "FAILED" ? "ONCHAIN_TRANSACTION_FAILED" : "ONCHAIN_TRANSFER_MISMATCH");
  }
  const expiration = Number(row.transaction_expiration_ms || signedTx?.raw_data?.expiration || 0);
  if (!Number.isFinite(expiration) || expiration <= Date.now()) {
    return markReview(admin, row, "SIGNED_TRANSACTION_EXPIRED_UNCONFIRMED");
  }
  // Persist the "may have been broadcast" state before contacting the node. If the
  // response is lost, retries can only rebroadcast these exact signed bytes and txid.
  const broadcastState = await updateSweep(admin, row, {
    status: "BROADCAST",
    broadcast_at: row.status === "BROADCAST" ? undefined : new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    failure_code: null,
  }, ["SIGNED", "BROADCAST"]);
  if (broadcastState.status !== "BROADCAST") {
    return { walletId: row.deposit_wallet_id, sweepId: row.id, status: "MANUAL_REVIEW_REQUIRED", code: "SWEEP_STATE_CHANGED_BEFORE_BROADCAST" };
  }
  try {
    await client.trx.sendRawTransaction(signedTx);
  } catch {
    // Response may be lost after acceptance. Saved signed bytes and txid remain authoritative.
  }
  return { walletId: row.deposit_wallet_id, sweepId: row.id, status: "BROADCAST_PENDING_CONFIRMATION", txid };
}

async function signAndPersist(admin: Admin, client: any, wallet: WalletRow, row: SweepRow, treasury: string) {
  const targeted = Boolean(String(row.target_deposit_txid || "").trim());
  const targetTxid = targeted ? String(row.target_deposit_txid || "").trim().toLowerCase() : "";
  const snapshot = targeted
    ? await getTargetedSafeSnapshot(admin, client, wallet, targetTxid, row.id)
    : await getSafeSnapshot(admin, client, wallet);
  if (snapshot.empty) return markReview(admin, row, "BALANCE_EMPTY_BEFORE_SIGNING");
  const sweepAmountRaw = targeted ? String(snapshot.amountRaw) : snapshot.balanceRaw;
  if (targeted) {
    if (sweepAmountRaw !== String(row.amount_raw) || snapshot.targetTxid !== targetTxid) {
      return markReview(admin, row, "TARGET_DEPOSIT_CHANGED_BEFORE_SIGNING");
    }
  } else if (snapshot.balanceRaw !== String(row.amount_raw)) {
    return markReview(admin, row, "BALANCE_CHANGED_BEFORE_SIGNING");
  }
  const sourceIds = snapshot.transfers.map((x) => x.txid);
  const freshKey = await buildSweepIdempotencyKey(wallet.id, NETWORK, TOKEN, sweepAmountRaw, targeted ? [targetTxid] : sourceIds);
  if (freshKey !== row.idempotency_key) return markReview(admin, row, "SOURCE_SNAPSHOT_CHANGED_BEFORE_SIGNING");
  const { data: savedItems, error: itemsError } = await admin.from("deposit_wallet_sweep_items")
    .select("deposit_submission_id,deposit_txid,amount_raw").eq("sweep_id", row.id);
  if (itemsError) return markReview(admin, row, "SOURCE_JOURNAL_LOOKUP_FAILED");
  if (!savedItems?.length) {
    const items = snapshot.transfers.map((item) => {
      const source = snapshot.sources.get(item.txid);
      if (!source) throw new Error("VERIFIED_SOURCE_MISSING");
      return { sweep_id: row.id, deposit_submission_id: source.id, deposit_txid: item.txid, amount_raw: item.rawAmount };
    });
    const { error: insertItemsError } = await admin.from("deposit_wallet_sweep_items").insert(items);
    if (insertItemsError) {
      const { data: existingItems, error: rereadError } = await admin.from("deposit_wallet_sweep_items")
        .select("deposit_submission_id,deposit_txid,amount_raw").eq("sweep_id", row.id);
      if (rereadError || !existingItems?.length) return markReview(admin, row, "SOURCE_JOURNAL_WRITE_FAILED");
      const normalize = (value: any) => ({
        txid: String(value.deposit_txid || "").toLowerCase(),
        submissionId: String(value.deposit_submission_id || ""),
        amountRaw: asRawBigInt(value.amount_raw).toString(),
      });
      const a = existingItems.map(normalize).sort((x: any, y: any) => x.txid.localeCompare(y.txid));
      const b = items.map(normalize).sort((x: any, y: any) => x.txid.localeCompare(y.txid));
      if (JSON.stringify(a) !== JSON.stringify(b)) return markReview(admin, row, "SOURCE_JOURNAL_CONFLICT");
    }
  } else {
    const actual = savedItems.map((x: any) => ({
      txid: String(x.deposit_txid || "").toLowerCase(),
      submissionId: String(x.deposit_submission_id || ""),
      amountRaw: asRawBigInt(x.amount_raw).toString(),
    })).sort((a: any, b: any) => a.txid.localeCompare(b.txid));
    const expected = snapshot.transfers.map((item) => {
      const source = snapshot.sources.get(item.txid);
      if (!source || !source.raw_amount || asRawBigInt(source.raw_amount) !== asRawBigInt(item.rawAmount)) {
        throw new Error("VERIFIED_SOURCE_MISSING_OR_AMOUNT_MISMATCH");
      }
      return { txid: item.txid, submissionId: source.id, amountRaw: asRawBigInt(item.rawAmount).toString() };
    }).sort((a: any, b: any) => a.txid.localeCompare(b.txid));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return markReview(admin, row, "SOURCE_JOURNAL_CONFLICT");
  }
  let transaction: any;
  try {
    const energyEstimate = await estimateUsdtTransferEnergy(wallet.address, treasury, sweepAmountRaw);
    const ext = await client.transactionBuilder.triggerSmartContract(
      TOKEN, "transfer(address,uint256)", { feeLimit: energyEstimate.feeLimitSun, callValue: 0 },
      [{ type: "address", value: treasury }, { type: "uint256", value: sweepAmountRaw }],
      wallet.address,
    );
    if (!ext?.result?.result || !ext?.transaction) return markReview(admin, row, "TRC20_TRANSFER_BUILD_FAILED");
    const bandwidthEstimate = estimateSweepBandwidth(String(ext.transaction.raw_data_hex || ""));
    if (!bandwidthEstimate) return markReview(admin, row, "TRC20_BANDWIDTH_ESTIMATE_UNAVAILABLE");
    const requiredBandwidth = Math.max(MIN_BANDWIDTH_FOR_SWEEP, Math.ceil(bandwidthEstimate * 1.1));
    const resources = await hasSufficientResources(client, wallet.address, energyEstimate.requiredEnergy, requiredBandwidth, energyEstimate.feeLimitSun);
    if (!resources.ok) return { walletId: wallet.id, sweepId: row.id, status: resources.code };
    const signed = await client.trx.sign(ext.transaction, await deriveTronHdIdentity(HD_MNEMONIC, HD_PASSPHRASE, Number(wallet.derivation_index)).then((x) => x.privateKey));
    const txid = String(signed?.txID || "");
    const expiration = Number(signed?.raw_data?.expiration || 0);
    if (!validTxid(txid) || !Number.isFinite(expiration) || expiration <= Date.now()) return markReview(admin, row, "SIGNED_TRANSACTION_INVALID");
    transaction = { txid, expiration, signed };
  } catch (error) {
    return { walletId: wallet.id, sweepId: row.id, status: "SIGNING_FAILED", code: errorCode(error) };
  }

  const { data: persisted, error: persistError } = await admin.from("deposit_wallet_sweeps").update({
    status: "SIGNED", txid: transaction.txid, signed_transaction: transaction.signed,
    transaction_expiration_ms: transaction.expiration, last_checked_at: new Date().toISOString(), failure_code: null,
  }).eq("id", row.id).eq("status", "PREPARED").select("*").maybeSingle();
  if (persistError) return { walletId: wallet.id, sweepId: row.id, status: "SIGNED_TRANSACTION_NOT_PERSISTED" };
  if (!persisted) {
    const { data: current, error: currentError } = await admin.from("deposit_wallet_sweeps").select("*").eq("id", row.id).maybeSingle();
    if (currentError || !current) return { walletId: wallet.id, sweepId: row.id, status: "JOURNAL_STATE_UNAVAILABLE" };
    return await processSavedTransaction(admin, client, current as SweepRow, treasury);
  }
  return await processSavedTransaction(admin, client, persisted as SweepRow, treasury);
}

async function processJournalRecord(admin: Admin, client: any, wallet: WalletRow, row: SweepRow, treasury: string) {
  const action = classifySweepAction(row);
  if (action === "ALREADY_CONFIRMED") return { walletId: wallet.id, sweepId: row.id, status: "ALREADY_CONFIRMED", txid: row.txid };
  if (action === "MANUAL_REVIEW") return { walletId: wallet.id, sweepId: row.id, status: "MANUAL_REVIEW_REQUIRED", code: row.failure_code || "SAVED_TRANSACTION_INVALID" };
  if (action === "RECONCILE_SAVED_TRANSACTION") return await processSavedTransaction(admin, client, row, treasury);
  return await signAndPersist(admin, client, wallet, row, treasury);
}

async function processWallet(admin: Admin, wallet: WalletRow, treasury: string) {
  const identity = await deriveTronHdIdentity(HD_MNEMONIC, HD_PASSPHRASE, Number(wallet.derivation_index));
  if (identity.address !== wallet.address || identity.rootFingerprint !== wallet.wallet_root_fingerprint) {
    return { walletId: wallet.id, status: "HD_ROOT_OR_ADDRESS_MISMATCH" };
  }
  const client = newTron(identity.privateKey);

  const { data: pendingRows, error: pendingError } = await admin.from("deposit_wallet_sweeps").select("*")
    .eq("deposit_wallet_id", wallet.id).in("status", ["PREPARED", "SIGNED", "BROADCAST", "FAILED_REVIEW"])
    .order("created_at", { ascending: false }).limit(1);
  if (pendingError) return { walletId: wallet.id, status: "JOURNAL_LOOKUP_FAILED" };
  const pending = pendingRows?.[0] as SweepRow | undefined;
  if (pending) return await processJournalRecord(admin, client, wallet, pending, treasury);

  let snapshot;
  try { snapshot = await getSafeSnapshot(admin, client, wallet); }
  catch (error) { return { walletId: wallet.id, status: "NOT_SWEPT", code: errorCode(error) === "SWEEP_PROCESSING_ERROR" ? String((error as Error).message || "SNAPSHOT_NOT_SAFE") : errorCode(error) }; }
  if (snapshot.empty) return { walletId: wallet.id, status: "NO_TOKEN_BALANCE" };
  const sourceIds = snapshot.transfers.map((x) => x.txid);
  const idempotencyKey = await buildSweepIdempotencyKey(wallet.id, NETWORK, TOKEN, snapshot.balanceRaw, sourceIds);
  const { data: inserted, error: insertError } = await admin.from("deposit_wallet_sweeps").insert({
    deposit_wallet_id: wallet.id, network: NETWORK, token_contract: TOKEN, treasury_address: treasury,
    amount_raw: snapshot.balanceRaw, idempotency_key: idempotencyKey, status: "PREPARED",
  }).select("*").single();
  if (insertError || !inserted) {
    const { data: existing, error: existingError } = await admin.from("deposit_wallet_sweeps")
      .select("*").eq("deposit_wallet_id", wallet.id).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existingError || !existing) return { walletId: wallet.id, status: "JOURNAL_CREATE_FAILED" };
    return await processJournalRecord(admin, client, wallet, existing as SweepRow, treasury);
  }
  // signAndPersist creates/verifies source-item links idempotently. This also recovers if a
  // process stopped after journal creation but before persisting the source links.
  return await signAndPersist(admin, client, wallet, inserted as SweepRow, treasury);
}


async function processTargetedWallet(admin: Admin, wallet: WalletRow, treasury: string, targetTxid: string) {
  const identity = await deriveTronHdIdentity(HD_MNEMONIC, HD_PASSPHRASE, Number(wallet.derivation_index));
  if (identity.address !== wallet.address || identity.rootFingerprint !== wallet.wallet_root_fingerprint) {
    return { walletId: wallet.id, status: "HD_ROOT_OR_ADDRESS_MISMATCH" };
  }
  const client = newTron(identity.privateKey);

  const { data: pendingRows, error: pendingError } = await admin.from("deposit_wallet_sweeps").select("*")
    .eq("deposit_wallet_id", wallet.id)
    .in("status", ["PREPARED", "SIGNED", "BROADCAST", "FAILED_REVIEW"])
    .order("created_at", { ascending: false }).limit(10);
  if (pendingError) return { walletId: wallet.id, status: "JOURNAL_LOOKUP_FAILED" };
  if ((pendingRows || []).length > 1) {
    return { walletId: wallet.id, status: "MANUAL_REVIEW_REQUIRED", code: "MULTIPLE_UNRESOLVED_SWEEP_JOURNALS" };
  }
  const pending = (pendingRows || [])[0] as SweepRow | undefined;
  if (pending) {
    if (String(pending.target_deposit_txid || "").toLowerCase() !== targetTxid) {
      return { walletId: wallet.id, sweepId: pending.id, status: "WALLET_HAS_PENDING_SWEEP" };
    }
    if (String(pending.status).toUpperCase() === "FAILED_REVIEW") {
      return { walletId: wallet.id, sweepId: pending.id, status: "MANUAL_REVIEW_REQUIRED", code: pending.failure_code || "PRIOR_SWEEP_REQUIRES_REVIEW" };
    }
    return await processJournalRecord(admin, client, wallet, pending, treasury);
  }

  let snapshot;
  try {
    snapshot = await getTargetedSafeSnapshot(admin, client, wallet, targetTxid);
  } catch (error) {
    return {
      walletId: wallet.id,
      status: "NOT_SWEPT",
      code: String((error as Error)?.message || "TARGETED_SNAPSHOT_NOT_SAFE"),
    };
  }
  const idempotencyKey = await buildSweepIdempotencyKey(wallet.id, NETWORK, TOKEN, snapshot.amountRaw, [targetTxid]);
  const { data: inserted, error: insertError } = await admin.from("deposit_wallet_sweeps").insert({
    deposit_wallet_id: wallet.id,
    network: NETWORK,
    token_contract: TOKEN,
    treasury_address: treasury,
    amount_raw: snapshot.amountRaw,
    target_deposit_txid: targetTxid,
    idempotency_key: idempotencyKey,
    status: "PREPARED",
  }).select("*").single();
  if (insertError || !inserted) {
    const { data: existing, error: existingError } = await admin.from("deposit_wallet_sweeps")
      .select("*").eq("deposit_wallet_id", wallet.id).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existingError || !existing) return { walletId: wallet.id, status: "JOURNAL_CREATE_FAILED" };
    if (String(existing.target_deposit_txid || "").toLowerCase() !== targetTxid
      || String(existing.amount_raw) !== snapshot.amountRaw) {
      return { walletId: wallet.id, sweepId: existing.id, status: "MANUAL_REVIEW_REQUIRED", code: "TARGETED_JOURNAL_IDENTITY_MISMATCH" };
    }
    return await processJournalRecord(admin, client, wallet, existing as SweepRow, treasury);
  }
  return await signAndPersist(admin, client, wallet, inserted as SweepRow, treasury);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let requestBody: Record<string, unknown> = {};
  const requestBodyText = await req.text().catch(() => "");
  if (requestBodyText.length > 4096) return json({ error: "Request body is too large." }, 413);
  if (requestBodyText.trim()) {
    try {
      const parsed = JSON.parse(requestBodyText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Invalid request body." }, 400);
      requestBody = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON request body." }, 400);
    }
  }
  if (Object.keys(requestBody).some((key) => !["wallet_id", "target_deposit_txid"].includes(key))) {
    return json({ error: "Unsupported request field." }, 400);
  }
  if (!TESTNET_SWEEP_ENABLED || !SHASTA_TEST_MODE_ENABLED) return json({ error: "Testnet sweep is disabled by default.", code: "TESTNET_SWEEP_DISABLED" }, 423);
  if (!SUPABASE_URL || !SERVICE_KEY || !HD_MNEMONIC || !TESTNET_PAYOUT_KEY || !TRONGRID_KEY) {
    return json({ error: "Testnet sweep is not configured." }, 503);
  }
  if (!shastaMnemonicsAreDistinct(HD_MNEMONIC, MAINNET_HD_MNEMONIC)) {
    return json({ error: "Both Shasta and Mainnet HD mnemonics must be present and distinct.", code: "SHASTA_SECRET_SEPARATION_BLOCKED" }, 423);
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const suppliedSecret = req.headers.get("x-aegis-cron-secret");
    if (!suppliedSecret) return json({ error: "Unauthorized." }, 401);
    const { data: secretMatches, error: secretError } = await admin.rpc("verify_testnet_sweep_cron_secret", { p_token: suppliedSecret });
    if (secretError || secretMatches !== true) return json({ error: "Unauthorized." }, 401);
    const [{ data: appEnabled, error: runtimeError }, { data: rulesRow, error: rulesError },
      { data: modeRow, error: modeError }, { data: productionRow, error: productionError }] = await Promise.all([
      admin.rpc("app_runtime_enabled"),
      admin.from("platform_settings").select("value_json").eq("key", "shasta_testnet_rules").maybeSingle(),
      admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle(),
      admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle(),
    ]);
    if (runtimeError || rulesError || modeError || productionError || !rulesRow?.value_json || !modeRow?.value_json || !productionRow?.value_json) {
      return json({ error: "Unable to verify sweep readiness." }, 503);
    }
    const rules = rulesRow.value_json, mode = modeRow.value_json, production = productionRow.value_json;
    if (appEnabled !== true) return json({ error: "AegisPay runtime is paused." }, 423);
    const validatedRules = await loadShastaTestRules(admin, SHASTA_TEST_MODE_ENABLED);
    if (!validatedRules || String(rules.network || "").toUpperCase() !== NETWORK || String(rules.token_contract || "") !== TOKEN) {
      return json({ error: "The separate Shasta test configuration is invalid or live-money gates are not safely closed.", code: "SHASTA_TEST_MODE_BLOCKED" }, 423);
    }
    const productionEnvironment = String(production.environment || "").toUpperCase();
    if (productionEnvironment !== "PRE_PRODUCTION" || String(mode.mode || "").toUpperCase() !== "MAINNET" ||
      mode.live_deposits !== false || mode.real_payouts !== false || mode.production_go_live_approved !== false ||
      production.live_deposits_enabled !== false || production.real_payouts_enabled !== false ||
      production.go_live_approved !== false || production.payouts_locked !== true) {
      return json({ error: "Sweep refused because production or payment gates are not safely closed.", code: "PRODUCTION_MODE_BLOCKED" }, 423);
    }
    const treasury = String(validatedRules.receiving_address || "").trim();
    if (!validAddress(treasury)) return json({ error: "Valid testnet treasury address is required." }, 503);
    const derivedTreasury = String(TronWeb.address.fromPrivateKey(TESTNET_PAYOUT_KEY) || "");
    if (derivedTreasury !== treasury) return json({ error: "Testnet treasury key mismatch.", code: "TREASURY_KEY_MISMATCH" }, 403);

    const { data: allowlistedUsers, error: allowlistError } = await admin.from("shasta_test_users")
      .select("user_id").eq("enabled", true);
    if (allowlistError) return json({ error: "Unable to confirm the Shasta test-account allowlist." }, 503);
    const testUserIds = [...new Set((allowlistedUsers || []).map((row: any) => String(row.user_id || "")))]
      .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
    if (!testUserIds.length) return json({ network: NETWORK, checked: 0, results: [], reason: "NO_ALLOWLISTED_TEST_USERS" });

    const hasWalletSelector = requestBody.wallet_id !== undefined;
    const hasDepositSelector = requestBody.target_deposit_txid !== undefined;
    if (hasWalletSelector || hasDepositSelector) {
      const walletId = String(requestBody.wallet_id || "");
      const targetTxid = String(requestBody.target_deposit_txid || "").trim().toLowerCase();
      if (!hasWalletSelector || !hasDepositSelector
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(walletId)
        || !validTxid(targetTxid)) {
        return json({ error: "Both a valid allowlisted wallet_id and target_deposit_txid are required." }, 400);
      }
      const { data: targetWallet, error: targetWalletError } = await admin.from("deposit_wallets")
        .select("id,user_id,address,derivation_index,wallet_root_fingerprint,token_contract,network")
        .eq("id", walletId).eq("network", NETWORK).eq("token_contract", TOKEN).eq("status", "ACTIVE")
        .in("user_id", testUserIds).maybeSingle();
      if (targetWalletError) return json({ error: "Unable to verify selected Shasta wallet." }, 503);
      if (!targetWallet) return json({ error: "Selected wallet is not active or is not allowlisted for Shasta testing." }, 403);
      let targetedResult: Record<string, unknown>;
      try {
        targetedResult = await processTargetedWallet(admin, targetWallet as WalletRow, treasury, targetTxid);
      } catch (error) {
        targetedResult = { walletId, status: "NOT_SWEPT", code: errorCode(error) };
      }
      const { error: rotationError } = await admin.from("deposit_wallets")
        .update({ last_sweep_attempt_at: new Date().toISOString() }).eq("id", walletId);
      if (rotationError) targetedResult.rotationMarked = false;
      return json({ network: NETWORK, checked: 1, targeted: true, results: [targetedResult], mainnetSweepEnabled: false });
    }

    const { data: wallets, error: walletError } = await admin.from("deposit_wallets")
      .select("id,user_id,address,derivation_index,wallet_root_fingerprint,token_contract,network")
      .eq("network", NETWORK).eq("token_contract", TOKEN).eq("status", "ACTIVE")
      .in("user_id", testUserIds)
      .order("last_sweep_attempt_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true }).limit(MAX_WALLETS_PER_RUN);
    if (walletError) return json({ error: "Unable to load allowlisted testnet deposit wallets." }, 500);
    const results = [];
    for (const wallet of (wallets || []) as WalletRow[]) {
      let result: Record<string, unknown>;
      try { result = await processWallet(admin, wallet, treasury); }
      catch (error) { result = { walletId: wallet.id, status: "NOT_SWEPT", code: errorCode(error) }; }
      const { error: rotationError } = await admin.from("deposit_wallets")
        .update({ last_sweep_attempt_at: new Date().toISOString() }).eq("id", wallet.id);
      if (rotationError) result.rotationMarked = false;
      results.push(result);
    }
    return json({ network: NETWORK, checked: results.length, results, mainnetSweepEnabled: false });
  } catch {
    return json({ error: "Testnet sweep failed safely." }, 500);
  }
});
