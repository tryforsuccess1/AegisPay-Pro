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

export function classifySweepAction(row: SweepRowState, nowMs = Date.now()): SweepNextAction {
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
    // Never mint a replacement automatically when a signed transaction may already have been broadcast.
    if (expiration <= nowMs) return "MANUAL_REVIEW";
    return "RECONCILE_SAVED_TRANSACTION";
  }
  return "MANUAL_REVIEW";
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
