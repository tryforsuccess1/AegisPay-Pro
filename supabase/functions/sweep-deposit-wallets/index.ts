import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TronWeb } from "npm:tronweb@6.0.4";
import { deriveTronHdIdentity } from "../_shared/tron-hd-wallet.ts";
import { buildSweepIdempotencyKey, classifySweepAction, classifySweepReceipt, hasEnoughSweepResources } from "../_shared/tron-sweep.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("AEGIS_CRON_SECRET") || "";
const HD_MNEMONIC = Deno.env.get("TRON_HD_WALLET_MNEMONIC") || "";
const HD_PASSPHRASE = Deno.env.get("TRON_HD_WALLET_PASSPHRASE") || "";
const TESTNET_PAYOUT_KEY = Deno.env.get("TRON_TESTNET_PAYOUT_PRIVATE_KEY") || "";
const TRONGRID_KEY = Deno.env.get("TRONGRID_API_KEY") || "";
const NETWORK = "TRON TESTNET";
const TOKEN = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const HOST = "https://api.shasta.trongrid.io";
const MAX_WALLETS_PER_RUN = 10;
const MAX_INBOUND_TXS = 200;
const FEE_LIMIT_SUN = 100_000_000;
const MIN_TRX_FOR_SWEEP_SUN = 120_000_000;
const MIN_ENERGY_FOR_SWEEP = 100_000;
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
  status: string; idempotency_key: string;
};
type IncomingTransfer = { txid: string; rawAmount: string; blockTimestamp: number };
type VerifiedSource = { id: string; txid: string; raw_amount?: string | null };

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
    .select("id,txid,raw_amount").eq("deposit_wallet_id", walletId).eq("status", "VERIFIED").limit(1000);
  if (error) throw new Error("VERIFIED_DEPOSIT_LOOKUP_FAILED");
  const map = new Map<string, VerifiedSource>();
  for (const row of data || []) {
    const txid = String(row.txid || "").toLowerCase();
    if (validTxid(txid)) map.set(txid, { id: String(row.id), txid, raw_amount: row.raw_amount == null ? null : String(row.raw_amount) });
  }
  return map;
}
async function getSafeSnapshot(admin: Admin, client: any, wallet: WalletRow) {
  const beforeBalance = await getTokenBalance(client, wallet.address);
  if (BigInt(beforeBalance) <= 0n) return { ok: true as const, empty: true as const, balanceRaw: "0", transfers: [], sources: new Map<string, VerifiedSource>() };
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
  return { ok: true as const, empty: false as const, balanceRaw: afterBalance, transfers: unsweptTransfers, sources };
}
async function hasSufficientResources(client: any, address: string) {
  const [trxBalance, resources] = await Promise.all([
    client.trx.getBalance(address),
    client.trx.getAccountResources(address),
  ]);
  const balance = Number(trxBalance);
  if (!Number.isFinite(balance) || balance < 0) return { ok: false, code: "TRX_BALANCE_UNAVAILABLE" };
  const energy = Math.max(0, Number(resources?.EnergyLimit || 0) - Number(resources?.EnergyUsed || 0));
  if (hasEnoughSweepResources(balance, energy, MIN_TRX_FOR_SWEEP_SUN, MIN_ENERGY_FOR_SWEEP, MIN_TRX_WITH_ENERGY_SUN)) {
    return { ok: true, code: balance >= MIN_TRX_FOR_SWEEP_SUN ? "TRX_FEE_RESERVE_READY" : "ENERGY_AND_BANDWIDTH_READY" };
  }
  return { ok: false, code: "NEEDS_TESTNET_TRX_OR_ENERGY" };
}

async function markConfirmed(admin: Admin, row: SweepRow, txid: string) {
  const updated = await updateSweep(admin, row, {
    status: "CONFIRMED", txid, confirmed_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(), failure_code: null,
  }, ["SIGNED", "BROADCAST"]);
  return { walletId: row.deposit_wallet_id, sweepId: row.id, status: updated.status === "CONFIRMED" ? "SWEPT_CONFIRMED" : updated.status, txid };
}

async function processSavedTransaction(admin: Admin, client: any, row: SweepRow, treasury: string) {
  const decision = classifySweepAction(row);
  if (decision === "ALREADY_CONFIRMED") return { walletId: row.deposit_wallet_id, sweepId: row.id, status: "ALREADY_CONFIRMED", txid: row.txid };
  if (decision === "MANUAL_REVIEW") return markReview(admin, row, "SAVED_TRANSACTION_INVALID_OR_EXPIRED");
  const txid = String(row.txid);
  const signedTx = row.signed_transaction;
  let info: any = null;
  try { info = await client.trx.getTransactionInfo(txid); } catch { /* Not yet indexed; rebroadcast only the exact saved signed bytes. */ }
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
  const snapshot = await getSafeSnapshot(admin, client, wallet);
  if (snapshot.empty || snapshot.balanceRaw !== String(row.amount_raw)) return markReview(admin, row, snapshot.empty ? "BALANCE_EMPTY_BEFORE_SIGNING" : "BALANCE_CHANGED_BEFORE_SIGNING");
  const sourceIds = snapshot.transfers.map((x) => x.txid);
  const freshKey = await buildSweepIdempotencyKey(wallet.id, NETWORK, TOKEN, snapshot.balanceRaw, sourceIds);
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
  const resources = await hasSufficientResources(client, wallet.address);
  if (!resources.ok) return { walletId: wallet.id, sweepId: row.id, status: resources.code };
  let transaction: any;
  try {
    const ext = await client.transactionBuilder.triggerSmartContract(
      TOKEN, "transfer(address,uint256)", { feeLimit: FEE_LIMIT_SUN, callValue: 0 },
      [{ type: "address", value: treasury }, { type: "uint256", value: snapshot.balanceRaw }],
      wallet.address,
    );
    if (!ext?.result?.result || !ext?.transaction) return markReview(admin, row, "TRC20_TRANSFER_BUILD_FAILED");
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !CRON_SECRET || !HD_MNEMONIC || !TESTNET_PAYOUT_KEY || !TRONGRID_KEY) {
    return json({ error: "Testnet sweep is not configured." }, 503);
  }
  if ((req.headers.get("x-aegis-cron-secret") || "") !== CRON_SECRET) return json({ error: "Unauthorized." }, 401);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ data: appEnabled, error: runtimeError }, { data: rulesRow, error: rulesError },
      { data: modeRow, error: modeError }, { data: productionRow, error: productionError }] = await Promise.all([
      admin.rpc("app_runtime_enabled"),
      admin.from("platform_settings").select("value_json").eq("key", "deposit_rules").maybeSingle(),
      admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle(),
      admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle(),
    ]);
    if (runtimeError || rulesError || modeError || productionError || !rulesRow?.value_json || !modeRow?.value_json || !productionRow?.value_json) {
      return json({ error: "Unable to verify sweep readiness." }, 503);
    }
    const rules = rulesRow.value_json, mode = modeRow.value_json, production = productionRow.value_json;
    if (appEnabled !== true) return json({ error: "AegisPay runtime is paused." }, 423);
    const productionEnvironment = String(production.environment || "").toUpperCase();
    if (String(rules.network || "").toUpperCase() !== NETWORK || String(rules.token_contract || "") !== TOKEN) {
      return json({ error: "This worker is restricted to the TRON Shasta testnet USDT contract.", code: "TESTNET_ONLY" }, 423);
    }
    if (productionEnvironment === "PRODUCTION" || mode.mode === "MAINNET" ||
      mode.live_deposits !== false || mode.real_payouts !== false || mode.production_go_live_approved !== false ||
      production.live_deposits_enabled !== false || production.real_payouts_enabled !== false ||
      production.go_live_approved !== false || production.payouts_locked !== true) {
      return json({ error: "Sweep refused because production or payment gates are not safely closed.", code: "PRODUCTION_MODE_BLOCKED" }, 423);
    }
    const treasury = String(rules.receiving_address || "").trim();
    if (!validAddress(treasury)) return json({ error: "Valid testnet treasury address is required." }, 503);
    const derivedTreasury = String(TronWeb.address.fromPrivateKey(TESTNET_PAYOUT_KEY) || "");
    if (derivedTreasury !== treasury) return json({ error: "Testnet treasury key mismatch.", code: "TREASURY_KEY_MISMATCH" }, 403);

    const { data: wallets, error: walletError } = await admin.from("deposit_wallets")
      .select("id,user_id,address,derivation_index,wallet_root_fingerprint,token_contract,network")
      .eq("network", NETWORK).eq("token_contract", TOKEN).eq("status", "ACTIVE")
      .order("created_at", { ascending: true }).limit(MAX_WALLETS_PER_RUN);
    if (walletError) return json({ error: "Unable to load testnet deposit wallets." }, 500);
    const results = [];
    for (const wallet of (wallets || []) as WalletRow[]) {
      try { results.push(await processWallet(admin, wallet, treasury)); }
      catch (error) { results.push({ walletId: wallet.id, status: "NOT_SWEPT", code: errorCode(error) }); }
    }
    return json({ network: NETWORK, checked: results.length, results, mainnetSweepEnabled: false });
  } catch {
    return json({ error: "Testnet sweep failed safely." }, 500);
  }
});
