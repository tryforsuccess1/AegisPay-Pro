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
  senderAddress: "TYNkpWrgPcqsZMeK2HzEnhkM6smp3nLcdz",
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
function expectCode(input: Parameters<typeof validateTargetedDepositSweep>[0], expected: string) {
  const result = validateTargetedDepositSweep(input);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.code, expected);
}

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
  expectCode(base({ source: { ...source, status: "PENDING" } }), "DEPOSIT_NOT_VERIFIED_BY_TRONGRID");
  expectCode(base({ source: { ...source, verificationSource: "Manual" } }), "DEPOSIT_NOT_VERIFIED_BY_TRONGRID");
});

Deno.test("rejects source identity, network, token, and receiving-address mismatches", () => {
  expectCode(base({ source: { ...source, txid: "b".repeat(64) } }), "VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  expectCode(base({ source: { ...source, walletId: "another-wallet" } }), "VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  expectCode(base({ source: { ...source, network: "TRON MAINNET" } }), "VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  expectCode(base({ source: { ...source, tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" } }), "VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  expectCode(base({ source: { ...source, receivingAddress: "TYNkpWrgPcqsZMeK2HzEnhkM6smp3nLcdz" } }), "VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  expectCode(base({ source: { ...source, senderAddress: address } }), "VERIFIED_DEPOSIT_IDENTITY_MISMATCH");
  expectCode(base({ transfers: [{ ...transfer, from: address }] }), "TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  expectCode(base({ network: "TRON MAINNET" }), "TARGET_NETWORK_OR_TOKEN_INVALID");
  expectCode(base({ tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" }), "TARGET_NETWORK_OR_TOKEN_INVALID");
});

Deno.test("rejects invalid, missing, duplicate, or mismatched on-chain transfers", () => {
  expectCode(base({ targetTxid: "bad" }), "TARGET_TXID_INVALID");
  expectCode(base({ transfers: [] }), "TARGET_TRANSFER_NOT_UNIQUELY_CONFIRMED");
  expectCode(base({ transfers: [transfer, transfer] }), "TARGET_TRANSFER_NOT_UNIQUELY_CONFIRMED");
  expectCode(base({ transfers: [{ ...transfer, success: false }] }), "TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  expectCode(base({ transfers: [{ ...transfer, type: "Approval" }] }), "TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  expectCode(base({ transfers: [{ ...transfer, decimals: 18 }] }), "TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  expectCode(base({ transfers: [{ ...transfer, to: "TYNkpWrgPcqsZMeK2HzEnhkM6smp3nLcdz" }] }), "TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  expectCode(base({ transfers: [{ ...transfer, contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" }] }), "TARGET_TRANSFER_CHAIN_DETAILS_MISMATCH");
  expectCode(base({ transfers: [{ ...transfer, rawAmount: "100000001" }] }), "TARGET_TRANSFER_AMOUNT_MISMATCH");
});

Deno.test("rejects insufficient balance, repeated source, and unresolved sweep journal", () => {
  expectCode(base({ balanceRaw: "99999999" }), "TOKEN_BALANCE_BELOW_TARGET_AMOUNT");
  expectCode(base({ alreadySwept: true }), "TARGET_DEPOSIT_ALREADY_SWEPT");
  expectCode(base({ pendingSweep: true }), "WALLET_HAS_PENDING_SWEEP");
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
