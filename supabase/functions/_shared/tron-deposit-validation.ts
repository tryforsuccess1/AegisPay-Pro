export const TRON_SHASTA_USDT_CONTRACT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";

const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TXID_RE = /^[a-fA-F0-9]{64}$/;

export type TronGridUsdtTransfer = {
  transaction_id?: unknown;
  from?: unknown;
  to?: unknown;
  value?: unknown;
  type?: unknown;
  success?: unknown;
  block_timestamp?: unknown;
  token_info?: { address?: unknown; decimals?: unknown } | null;
};

export function usdtAmountToRaw(value: unknown): string | null {
  const input = typeof value === "number"
    ? (Number.isFinite(value) ? String(value) : "")
    : typeof value === "string" ? value.trim() : "";
  // Parse decimal text only. Never round a JavaScript float into a money amount.
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(input)) return null;
  const [units, fractional = ""] = input.split(".");
  const raw = BigInt(units) * 1_000_000n + BigInt((fractional + "000000").slice(0, 6));
  return raw > 0n ? raw.toString() : null;
}

/**
 * Finds a confirmed Shasta USDT Transfer row matching the full transaction
 * identity. The caller must request only_confirmed=true from the Shasta API.
 * The configured token address is pinned here independently of database settings.
 */
export function findExactShastaUsdtTransfer(
  rows: unknown,
  txid: string,
  recipient: string,
): TronGridUsdtTransfer | null {
  if (!TXID_RE.test(String(txid || "")) || !TRON_ADDRESS_RE.test(String(recipient || "")) || !Array.isArray(rows)) {
    return null;
  }
  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const row = value as TronGridUsdtTransfer;
    const rowTxid = String(row.transaction_id || "");
    const sender = String(row.from || "");
    const receiver = String(row.to || "");
    const token = row.token_info;
    const raw = String(row.value ?? "");
    const timestamp = Number(row.block_timestamp);
    if (!TXID_RE.test(rowTxid) || rowTxid.toLowerCase() !== txid.toLowerCase()) continue;
    if (!TRON_ADDRESS_RE.test(sender) || receiver !== recipient) continue;
    if (String(token?.address || "") !== TRON_SHASTA_USDT_CONTRACT || Number(token?.decimals) !== 6) continue;
    if (String(row.type || "").toLowerCase() !== "transfer" || row.success === false) continue;
    if (!/^[1-9][0-9]*$/.test(raw) || raw.length > 78) continue;
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    return row;
  }
  return null;
}

export function exactUsdtRawAmountMatches(transfer: TronGridUsdtTransfer, expectedGrossAmount: unknown): boolean {
  const expectedRaw = usdtAmountToRaw(expectedGrossAmount);
  const actualRaw = String(transfer.value ?? "");
  if (!expectedRaw || !/^[1-9][0-9]*$/.test(actualRaw) || actualRaw.length > 78) return false;
  try {
    return BigInt(actualRaw) === BigInt(expectedRaw);
  } catch {
    return false;
  }
}
