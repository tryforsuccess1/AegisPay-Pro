import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { buildSweepIdempotencyKey, classifySweepAction, classifySweepReceipt, estimateSweepBandwidth, estimateSweepEnergyRequirement, estimateSweepFeeLimitSun, getAvailableBandwidth, hasEnoughSweepResources, isSuccessfulSweepSimulation, TRC20_TRANSFER_TOPIC } from "./tron-sweep.ts";

const txid = "a".repeat(64);
const signed = { txID: txid, raw_data: { expiration: 2_000_000_000_000 }, signature: ["test-signature"] };
const contractHex = "41" + "1".repeat(40);
const treasuryHex = "41" + "2".repeat(40);
const recipientTopic = "0x" + "0".repeat(24) + "2".repeat(40);
function successInfo(toTopic = recipientTopic, rawAmount = 1000n) {
  return {
    id: txid,
    receipt: { result: "SUCCESS" },
    log: [{
      address: contractHex,
      topics: ["0x" + TRC20_TRANSFER_TOPIC, "0x" + "0".repeat(64), toTopic],
      data: "0x" + rawAmount.toString(16).padStart(64, "0"),
    }],
  };
}

Deno.test("sweep key is stable for reordered source TXIDs and canonical amounts", async () => {
  const one = await buildSweepIdempotencyKey("WALLET-1", "tron testnet", "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs", "0001000", [txid, "b".repeat(64)]);
  const two = await buildSweepIdempotencyKey("wallet-1", "TRON TESTNET", "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs", "1000", ["b".repeat(64), txid.toUpperCase()]);
  assertEquals(one, two);
  assertEquals(one.length, 64);
});

Deno.test("sweep key changes when the balance or verified source transactions change", async () => {
  const a = await buildSweepIdempotencyKey("wallet-1", "TRON TESTNET", "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs", "1000", [txid]);
  const b = await buildSweepIdempotencyKey("wallet-1", "TRON TESTNET", "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs", "1001", [txid]);
  const c = await buildSweepIdempotencyKey("wallet-1", "TRON TESTNET", "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs", "1000", ["b".repeat(64)]);
  assertNotEquals(a, b);
  assertNotEquals(a, c);
});

Deno.test("PREPARED rows may be signed only before broadcast bytes exist", () => {
  assertEquals(classifySweepAction({ status: "PREPARED" }), "SIGN_AND_PERSIST");
  assertEquals(classifySweepAction({ status: "PREPARED", txid, signed_transaction: signed }), "MANUAL_REVIEW");
});

Deno.test("signed and broadcast rows reuse their saved transaction only", () => {
  assertEquals(classifySweepAction({ status: "SIGNED", txid, signed_transaction: signed }, 1_900_000_000_000), "RECONCILE_SAVED_TRANSACTION");
  assertEquals(classifySweepAction({ status: "BROADCAST", txid, signed_transaction: signed }, 1_900_000_000_000), "RECONCILE_SAVED_TRANSACTION");
  assertEquals(classifySweepAction({ status: "SIGNED", txid, signed_transaction: signed }, 2_100_000_000_000), "RECONCILE_SAVED_TRANSACTION");
  assertEquals(classifySweepAction({ status: "SIGNED", txid: "b".repeat(64), signed_transaction: signed }, 1_900_000_000_000), "MANUAL_REVIEW");
});

Deno.test("confirmed and failed-review rows cannot initiate new transfers", () => {
  assertEquals(classifySweepAction({ status: "CONFIRMED" }), "ALREADY_CONFIRMED");
  assertEquals(classifySweepAction({ status: "FAILED_REVIEW" }), "MANUAL_REVIEW");
});

Deno.test("resource guard requires TRX reserve or energy plus bandwidth", () => {
  const minimumTrx = 120_000_000;
  const minimumEnergy = 100_000;
  const minimumBandwidth = 1_000;
  const minimumTrxWithResources = 1_000_000;

  assertEquals(hasEnoughSweepResources(119_999_999, 0, 0, minimumTrx, minimumEnergy, minimumBandwidth, minimumTrxWithResources), false);
  assertEquals(hasEnoughSweepResources(minimumTrx, 0, 0, minimumTrx, minimumEnergy, minimumBandwidth, minimumTrxWithResources), true);
  assertEquals(hasEnoughSweepResources(minimumTrxWithResources, minimumEnergy, minimumBandwidth - 1, minimumTrx, minimumEnergy, minimumBandwidth, minimumTrxWithResources), false);
  assertEquals(hasEnoughSweepResources(minimumTrxWithResources, minimumEnergy - 1, minimumBandwidth, minimumTrx, minimumEnergy, minimumBandwidth, minimumTrxWithResources), false);
  assertEquals(hasEnoughSweepResources(minimumTrxWithResources, minimumEnergy, minimumBandwidth, minimumTrx, minimumEnergy, minimumBandwidth, minimumTrxWithResources), true);
  assertEquals(hasEnoughSweepResources(Number.NaN, 200_000, 2_000, minimumTrx, minimumEnergy, minimumBandwidth, minimumTrxWithResources), false);
  assertEquals(hasEnoughSweepResources(minimumTrxWithResources, 200_000, Number.NaN, minimumTrx, minimumEnergy, minimumBandwidth, minimumTrxWithResources), false);
});

Deno.test("TRON Bandwidth sources are checked independently and never added together", () => {
  assertEquals(getAvailableBandwidth(500, 0, 600, 0), 600);
  assertEquals(getAvailableBandwidth(1_200, 200, 600, 100), 1_000);
  assertEquals(getAvailableBandwidth(0, 0, 600, 100), 500);
  assertEquals(getAvailableBandwidth(Number.NaN, 0, 600, 0), 0);
});

Deno.test("sweep Energy estimate applies a bounded safety multiplier and fails closed on invalid input", () => {
  assertEquals(estimateSweepEnergyRequirement(65_000), 84_500);
  assertEquals(estimateSweepEnergyRequirement(65_000, 1.5), 97_500);
  assertEquals(estimateSweepEnergyRequirement(0), 0);
  assertEquals(estimateSweepEnergyRequirement(1_000_001), 0);
  assertEquals(estimateSweepEnergyRequirement(65_000, 0.9), 0);
  assertEquals(estimateSweepEnergyRequirement(65_000, 2.1), 0);
});

Deno.test("sweep fee limit derives from chain Energy price and fails closed above cap", () => {
  assertEquals(estimateSweepFeeLimitSun(65_000, 420, 100_000_000), 38_855_000);
  assertEquals(estimateSweepFeeLimitSun(65_000, 420, 30_000_000), 0);
  assertEquals(estimateSweepFeeLimitSun(65_000, 0, 100_000_000), 0);
  assertEquals(estimateSweepFeeLimitSun(0, 420, 100_000_000), 0);
  assertEquals(estimateSweepFeeLimitSun(65_000, 420, 100_000_000, 1.35, Number.NaN), 0);
});

Deno.test("sweep fallback simulation requires successful TVM execution", () => {
  assertEquals(isSuccessfulSweepSimulation({ result: { result: true }, transaction: { ret: [{ ret: "SUCCESS" }] } }), true);
  assertEquals(isSuccessfulSweepSimulation({ result: { result: true }, transaction: { ret: [{ ret: "FAILED" }] } }), false);
  assertEquals(isSuccessfulSweepSimulation({ result: { result: false }, transaction: { ret: [{ ret: "SUCCESS" }] } }), false);
  assertEquals(isSuccessfulSweepSimulation({ result: { result: true }, transaction: { ret: [] } }), false);
  assertEquals(isSuccessfulSweepSimulation({ result: { result: true } }), false);
  assertEquals(isSuccessfulSweepSimulation({ result: { result: true }, transaction: { ret: [{}] } }), false);
  assertEquals(isSuccessfulSweepSimulation({ result: { result: true }, transaction: { ret: [{ ret: "SUCCESS" }, { ret: "FAILED" }] } }), false);
  assertEquals(isSuccessfulSweepSimulation({ result: { result: true }, transaction: { ret: [{ ret: "success" }] } }), true);
  assertEquals(isSuccessfulSweepSimulation(null), false);
});

Deno.test("estimated transaction Bandwidth includes protobuf result and signature overhead", () => {
  assertEquals(estimateSweepBandwidth("aa".repeat(200)), 334);
  assertEquals(estimateSweepBandwidth("aa".repeat(200), 2), 401);
  assertEquals(estimateSweepBandwidth("abc"), 0);
  assertEquals(estimateSweepBandwidth("zz"), 0);
});

Deno.test("successful receipt requires an exact contract, recipient and raw amount", () => {
  assertEquals(classifySweepReceipt(successInfo(), txid, contractHex, treasuryHex, "1000"), "CONFIRMED");
  assertEquals(classifySweepReceipt(successInfo("0x" + "0".repeat(24) + "3".repeat(40)), txid, contractHex, treasuryHex, "1000"), "MISMATCH");
  assertEquals(classifySweepReceipt(successInfo(recipientTopic, 1001n), txid, contractHex, treasuryHex, "1000"), "MISMATCH");
  assertEquals(classifySweepReceipt(successInfo(), "b".repeat(64), contractHex, treasuryHex, "1000"), "PENDING");
  assertEquals(classifySweepReceipt({ id: txid, receipt: { result: "OUT_OF_ENERGY" }, log: [] }, txid, contractHex, treasuryHex, "1000"), "FAILED");
  assertEquals(classifySweepReceipt(null, txid, contractHex, treasuryHex, "1000"), "PENDING");
});

Deno.test("idempotency key rejects malformed source txids and non-positive balance", async () => {
  await assertRejects(() => buildSweepIdempotencyKey("wallet", "TRON TESTNET", "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs", "0", [txid]));
  await assertRejects(() => buildSweepIdempotencyKey("wallet", "TRON TESTNET", "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs", "2", ["not-a-txid"]));
});
