export const SHASTA_USDT_CONTRACT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
export const SHASTA_NETWORK = "TRON TESTNET";

type Source = {
  id: string;
  txid: string;
  status: string;
  rawAmount: string;
  verificationSource: string;
  walletId: string;
  network: string;
  tokenContract: string;
  receivingAddress: string;
};

type Transfer = {
  txid: string;
  rawAmount: string;
  to: string;
  contract: string;
  success?: boolean | null;
  decimals: number;
  type: string;
};

export type TargetedSweepInput = {
  walletId: string;
  walletAddress: string;
  network: string;
  tokenContract: string;
  targetTxid: string;
  balanceRaw: string;
  source: Source;
  transfers: Transfer[];
  alreadySwept: boolean;
  pendingSweep: boolean;
};

export type TargetedSweepResult =
  | { ok: true; amountRaw: string; balanceRaw: string; targetTxid: string; sourceId: string }
  | { ok: false; code: string };

const TXID_RE = /^[a-fA-F0-9]{64}$/;
const ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const RAW_RE = /^[1-9][0-9]{0,77}$/;

function fail(code: string): TargetedSweepResult {
  return { ok: false, code };
}

/**
 * Fail-closed policy for one explicitly selected Shasta deposit.
 * Surplus wallet balance is deliberately ignored; only the matching verified
 * deposit source amount can become the sweep amount.
 */
export function validateTargetedDepositSweep(input: TargetedSweepInput): TargetedSweepResult {
  if (!input || typeof input !== "object") return fail("TARGET_REQUEST_INVALID");
  if (!input.walletId || !ADDRESS_RE.test(String(input.walletAddress || ""))) {
    return fail("TARGET_WALLET_INVALID");
  }
  if (String(input.network || "").toUpperCase() !== SHASTA_NETWORK
    || String(input.tokenContract || "") !== SHASTA_USDT_CONTRACT) {
    return fail("TARGET_NETWORK_OR_TOKEN_INVALID");
  }
  const targetTxid = String(input.targetTxid || "").toLowerCase();
  if (!TXID_RE.test(targetTxid)) return fail("TARGET_TXID_INVALID");

  const source = input.source;
  if (!source || String(source.status || "").toUpperCase() !== "VERIFIED"
    || !["TronGrid", "TronGrid Monitor"].includes(String(source.verificationSource || ""))) {
    return fail("DEPOSIT_NOT_VERIFIED_BY_TRONGRID");
  }
  if (String(source.walletId || "") !== input.walletId
    || String(source.txid || "").toLowerCase() !== targetTxid
    || String(source.network || "").toUpperCase() !== SHASTA_NETWORK
    || String(source.tokenContract || "") !== SHASTA_USDT_CONTRACT
    || String(source.receivingAddress || "") !== input.walletAddress) {
    return fail("VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  }
  const amountRaw = String(source.rawAmount || "");
  if (!RAW_RE.test(amountRaw)) return fail("VERIFIED_DEPOSIT_AMOUNT_INVALID");

  if (!Array.isArray(input.transfers)) return fail("TARGET_TRANSFER_NOT_UNIQUELY_CONFIRMED");
  const matching = input.transfers.filter((item) =>
    String(item?.txid || "").toLowerCase() === targetTxid
  );
  if (matching.length !== 1) return fail("TARGET_TRANSFER_NOT_UNIQUELY_CONFIRMED");
  const transfer = matching[0];
  if (transfer.success === false
    || String(transfer.to || "") !== input.walletAddress
    || String(transfer.contract || "") !== SHASTA_USDT_CONTRACT
    || Number(transfer.decimals) !== 6
    || String(transfer.type || "").toLowerCase() !== "transfer") {
    return fail("TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  }
  if (String(transfer.rawAmount || "") !== amountRaw) {
    return fail("TARGET_TRANSFER_AMOUNT_MISMATCH");
  }

  const balanceRaw = String(input.balanceRaw || "");
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(balanceRaw)) {
    return fail("TOKEN_BALANCE_INVALID");
  }
  if (BigInt(balanceRaw) < BigInt(amountRaw)) return fail("TOKEN_BALANCE_BELOW_TARGET_AMOUNT");
  if (input.alreadySwept) return fail("TARGET_DEPOSIT_ALREADY_SWEPT");
  if (input.pendingSweep) return fail("WALLET_HAS_PENDING_SWEEP");

  return {
    ok: true,
    amountRaw,
    balanceRaw,
    targetTxid,
    sourceId: String(source.id),
  };
}
