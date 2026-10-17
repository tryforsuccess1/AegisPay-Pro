import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { buildSweepIdempotencyKey, classifySweepAction, classifySweepReceipt, hasEnoughSweepResources, TRC20_TRANSFER_TOPIC } from "./tron-sweep.ts";

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

Deno.test("resource guard requires conservative TRX or both energy and bandwidth reserve", () => {
  assertEquals(hasEnoughSweepResources(119_999_999, 0, 120_000_000, 100_000, 1_000_000), false);
  assertEquals(hasEnoughSweepResources(120_000_000, 0, 120_000_000, 100_000, 1_000_000), true);
  assertEquals(hasEnoughSweepResources(1_000_000, 99_999, 120_000_000, 100_000, 1_000_000), false);
  assertEquals(hasEnoughSweepResources(1_000_000, 100_000, 120_000_000, 100_000, 1_000_000), true);
  assertEquals(hasEnoughSweepResources(Number.NaN, 200_000, 120_000_000, 100_000, 1_000_000), false);
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
