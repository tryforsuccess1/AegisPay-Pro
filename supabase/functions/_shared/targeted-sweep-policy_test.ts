import { assertEquals } from "jsr:@std/assert@1.0.14";
import { validateTargetedDepositSweep } from "./targeted-sweep-policy.ts";

const walletId = "wallet-100";
const address = "TY2u8sfvVN4UeS19dMw7udrqGrznk4L3yc";
const txid = "90ddb11963ef7ac9a45172ff95d0acd736febaff6dc245615b7807c8daeaf73c";
const token = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const source = {
  id: "deposit-100",
  txid,
  status: "VERIFIED",
  rawAmount: "100000000",
  verificationSource: "TronGrid",
  walletId,
  network: "TRON TESTNET",
  tokenContract: token,
  receivingAddress: address,
};
const transfer = {
  txid,
  rawAmount: "100000000",
  to: address,
  contract: token,
  success: true,
  decimals: 6,
  type: "Transfer",
  from: "TYNkpWrgPcqsZMeK2HzEnhkM6smp3nLcdz",
  blockTimestamp: 1793210000000,
};
function base(overrides: Record<string, unknown> = {}) {
  return {
    walletId,
    walletAddress: address,
    network: "TRON TESTNET",
    tokenContract: token,
    targetTxid: txid,
    balanceRaw: "2100000000",
    source,
    transfers: [transfer],
    alreadySwept: false,
    pendingSweep: false,
    ...overrides,
  } as Parameters<typeof validateTargetedDepositSweep>[0];
}

Deno.test("targets only the verified 100 USDT deposit when wallet has 2,100 USDT", () => {
  assertEquals(validateTargetedDepositSweep(base()), {
    ok: true,
    amountRaw: "100000000",
    balanceRaw: "2100000000",
    targetTxid: txid,
    sourceId: "deposit-100",
  });
});

Deno.test("targets only the verified 500 USDT deposit when wallet has 1,500 USDT", () => {
  const fiveHundredAddress = "TYNkpWrgPcqsZMeK2HzEnhkM6smp3nLcdz";
  const fiveHundredTxid = "5c3adac67eea7320efdd341d6dd83421656931dbf427e0ac1d6bec569048cb41";
  const result = validateTargetedDepositSweep(base({
    walletId: "wallet-500",
    walletAddress: fiveHundredAddress,
    targetTxid: fiveHundredTxid,
    balanceRaw: "1500000000",
    source: {
      ...source,
      id: "deposit-500",
      txid: fiveHundredTxid,
      rawAmount: "500000000",
      walletId: "wallet-500",
      receivingAddress: fiveHundredAddress,
    },
    transfers: [{
      ...transfer,
      txid: fiveHundredTxid,
      rawAmount: "500000000",
      to: fiveHundredAddress,
    }],
  }));
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.amountRaw, "500000000");
});

Deno.test("rejects a source that is not VERIFIED or not TronGrid verified", () => {
  assertEquals(validateTargetedDepositSweep(base({ source: { ...source, status: "PENDING" } })).code, "DEPOSIT_NOT_VERIFIED_BY_TRONGRID");
  assertEquals(validateTargetedDepositSweep(base({ source: { ...source, verificationSource: "Manual" } })).code, "DEPOSIT_NOT_VERIFIED_BY_TRONGRID");
});

Deno.test("rejects source identity, network, token, and receiving-address mismatches", () => {
  assertEquals(validateTargetedDepositSweep(base({ source: { ...source, txid: "b".repeat(64) } })).code, "VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  assertEquals(validateTargetedDepositSweep(base({ source: { ...source, walletId: "another-wallet" } })).code, "VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  assertEquals(validateTargetedDepositSweep(base({ source: { ...source, network: "TRON MAINNET" } })).code, "VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  assertEquals(validateTargetedDepositSweep(base({ source: { ...source, tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" } })).code, "VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  assertEquals(validateTargetedDepositSweep(base({ source: { ...source, receivingAddress: "TYNkpWrgPcqsZMeK2HzEnhkM6smp3nLcdz" } })).code, "VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  assertEquals(validateTargetedDepositSweep(base({ network: "TRON MAINNET" })).code, "TARGET_NETWORK_OR_TOKEN_INVALID");
  assertEquals(validateTargetedDepositSweep(base({ tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" })).code, "TARGET_NETWORK_OR_TOKEN_INVALID");
});

Deno.test("rejects invalid, missing, duplicate, or mismatched on-chain transfers", () => {
  assertEquals(validateTargetedDepositSweep(base({ targetTxid: "bad" })).code, "TARGET_TXID_INVALID");
  assertEquals(validateTargetedDepositSweep(base({ transfers: [] })).code, "TARGET_TRANSFER_NOT_UNIQUELY_CONFIRMED");
  assertEquals(validateTargetedDepositSweep(base({ transfers: [transfer, transfer] })).code, "TARGET_TRANSFER_NOT_UNIQUELY_CONFIRMED");
  assertEquals(validateTargetedDepositSweep(base({ transfers: [{ ...transfer, success: false }] })).code, "TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  assertEquals(validateTargetedDepositSweep(base({ transfers: [{ ...transfer, type: "Approval" }] })).code, "TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  assertEquals(validateTargetedDepositSweep(base({ transfers: [{ ...transfer, decimals: 18 }] })).code, "TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  assertEquals(validateTargetedDepositSweep(base({ transfers: [{ ...transfer, to: "TYNkpWrgPcqsZMeK2HzEnhkM6smp3nLcdz" }] })).code, "TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  assertEquals(validateTargetedDepositSweep(base({ transfers: [{ ...transfer, contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" }] })).code, "TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  assertEquals(validateTargetedDepositSweep(base({ transfers: [{ ...transfer, rawAmount: "100000001" }] })).code, "TARGET_TRANSFER_AMOUNT_MISMATCH");
});

Deno.test("rejects insufficient balance, repeated source, and unresolved sweep journal", () => {
  assertEquals(validateTargetedDepositSweep(base({ balanceRaw: "99999999" })).code, "TOKEN_BALANCE_BELOW_TARGET_AMOUNT");
  assertEquals(validateTargetedDepositSweep(base({ alreadySwept: true })).code, "TARGET_DEPOSIT_ALREADY_SWEPT");
  assertEquals(validateTargetedDepositSweep(base({ pendingSweep: true })).code, "WALLET_HAS_PENDING_SWEEP");
});

Deno.test("surplus unverified faucet balance and other deposits never increase target amount", () => {
  const result = validateTargetedDepositSweep(base({
    balanceRaw: "2100000000",
    transfers: [transfer, {
      ...transfer,
      txid: "c".repeat(64),
      rawAmount: "2000000000",
    }],
  }));
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.amountRaw, "100000000");
    assertEquals(result.balanceRaw, "2100000000");
  }
});
