export type SweepRowState = {
  status: string;
  txid?: string | null;
  signed_transaction?: unknown;
  transaction_expiration_ms?: number | null;
};

export type SweepNextAction =
  | "SIGN_AND_PERSIST"
  | "RECONCILE_SAVED_TRANSACTION"
  | "ALREADY_CONFIRMED"
  | "MANUAL_REVIEW";

export type SweepReceiptState = "CONFIRMED" | "FAILED" | "PENDING" | "MISMATCH";
export const TRC20_TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function classifySweepAction(row: SweepRowState, _nowMs = Date.now()): SweepNextAction {
  const status = String(row.status || "").toUpperCase();
  if (status === "CONFIRMED") return "ALREADY_CONFIRMED";
  if (status === "FAILED_REVIEW") return "MANUAL_REVIEW";
  if (status === "PREPARED") {
    // No transfer may be broadcast until the exact signed bytes and txid are persisted.
    if (row.txid || row.signed_transaction || row.transaction_expiration_ms) return "MANUAL_REVIEW";
    return "SIGN_AND_PERSIST";
  }
  if (status === "SIGNED" || status === "BROADCAST") {
    const tx = row.signed_transaction as { txID?: unknown; raw_data?: { expiration?: unknown } } | null;
    const storedTxId = String(row.txid || "");
    const txIdInSigned = String(tx?.txID || "");
    const expiration = Number(row.transaction_expiration_ms ?? tx?.raw_data?.expiration);
    if (!/^[a-fA-F0-9]{64}$/.test(storedTxId) || storedTxId.toLowerCase() !== txIdInSigned.toLowerCase()
      || !tx || typeof tx !== "object" || !Number.isFinite(expiration) || expiration <= 0) {
      return "MANUAL_REVIEW";
    }
    // Reconcile the chain receipt before deciding whether expiry requires human review.
    // Never mint a replacement automatically when a signed transaction may already have been broadcast.
    return "RECONCILE_SAVED_TRANSACTION";
  }
  return "MANUAL_REVIEW";
}

export function hasEnoughSweepResources(
  trxBalanceSun: number,
  availableEnergy: number,
  availableBandwidth: number,
  minimumTrxSun: number,
  minimumEnergy: number,
  minimumBandwidth: number,
  minimumTrxWithResourcesSun: number,
): boolean {
  const values = [trxBalanceSun, availableEnergy, availableBandwidth, minimumTrxSun, minimumEnergy, minimumBandwidth, minimumTrxWithResourcesSun];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return false;
  return trxBalanceSun >= minimumTrxSun ||
    (trxBalanceSun >= minimumTrxWithResourcesSun
      && availableEnergy >= minimumEnergy
      && availableBandwidth >= minimumBandwidth);
}

function hexTail(value: unknown): string {
  return String(value || "").replace(/^0x/i, "").toLowerCase().slice(-40);
}

export function classifySweepReceipt(
  info: unknown,
  txid: string,
  expectedContractHex: string,
  expectedTreasuryHex: string,
  amountRaw: string,
): SweepReceiptState {
  const receipt = info as {
    id?: unknown;
    receipt?: { result?: unknown } | null;
    log?: Array<{ address?: unknown; topics?: unknown[]; data?: unknown }> | null;
  } | null;
  if (!receipt || !receipt.id || String(receipt.id).toLowerCase() !== txid.toLowerCase()) return "PENDING";
  if (!receipt.receipt || !receipt.receipt.result) return "PENDING";
  if (String(receipt.receipt.result).toUpperCase() !== "SUCCESS") return "FAILED";
  const logs = Array.isArray(receipt.log) ? receipt.log : [];
  const contractTail = hexTail(expectedContractHex);
  const treasuryTail = hexTail(expectedTreasuryHex);
  const expectedAmount = BigInt(amountRaw);
  const match = logs.some((log) => {
    const topics = Array.isArray(log.topics) ? log.topics.map((value) => String(value).replace(/^0x/i, "").toLowerCase()) : [];
    if (hexTail(log.address) !== contractTail || topics[0] !== TRC20_TRANSFER_TOPIC || topics.length < 3) return false;
    if (topics[2].slice(-40) !== treasuryTail) return false;
    try { return BigInt("0x" + String(log.data || "0").replace(/^0x/i, "")) === expectedAmount; }
    catch { return false; }
  });
  return match ? "CONFIRMED" : "MISMATCH";
}

export async function buildSweepIdempotencyKey(
  walletId: string,
  network: string,
  tokenContract: string,
  balanceRaw: string,
  sourceTxids: string[],
): Promise<string> {
  const wallet = String(walletId || "").trim().toLowerCase();
  const normalizedNetwork = String(network || "").trim().toUpperCase();
  const token = String(tokenContract || "").trim();
  const balance = BigInt(String(balanceRaw)).toString();
  const txids = sourceTxids.map((value) => String(value || "").trim().toLowerCase()).sort();
  if (!wallet || !normalizedNetwork || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(token)
    || BigInt(balance) <= 0n || txids.length === 0
    || txids.some((value) => !/^[a-fA-F0-9]{64}$/.test(value))) {
    throw new Error("Invalid sweep idempotency inputs.");
  }
  const canonical = [wallet, normalizedNetwork, token, balance, ...txids].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}
