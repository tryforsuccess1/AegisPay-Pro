import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  exactUsdtRawAmountMatches,
  findExactShastaUsdtTransfer,
  TRON_SHASTA_USDT_CONTRACT,
  usdtAmountToRaw,
} from "./tron-deposit-validation.ts";

const txid = "a".repeat(64);
const recipient = "T" + "2".repeat(33);
const sender = "T" + "3".repeat(33);
const validTransfer = {
  transaction_id: txid,
  from: sender,
  to: recipient,
  value: "12340000",
  type: "Transfer",
  success: true,
  block_timestamp: 1_790_000_000_000,
  token_info: { address: TRON_SHASTA_USDT_CONTRACT, decimals: 6 },
};

Deno.test("accepts only a matching Shasta USDT transfer identity", () => {
  assertEquals(findExactShastaUsdtTransfer([validTransfer], txid, recipient), validTransfer);
  assertEquals(findExactShastaUsdtTransfer([{ ...validTransfer, transaction_id: "b".repeat(64) }], txid, recipient), null);
  assertEquals(findExactShastaUsdtTransfer([{ ...validTransfer, to: sender }], txid, recipient), null);
  assertEquals(findExactShastaUsdtTransfer([{ ...validTransfer, from: "not-an-address" }], txid, recipient), null);
  assertEquals(findExactShastaUsdtTransfer([{ ...validTransfer, token_info: { address: recipient, decimals: 6 } }], txid, recipient), null);
  assertEquals(findExactShastaUsdtTransfer([{ ...validTransfer, token_info: { address: TRON_SHASTA_USDT_CONTRACT, decimals: 18 } }], txid, recipient), null);
  assertEquals(findExactShastaUsdtTransfer([{ ...validTransfer, type: "Approval" }], txid, recipient), null);
  assertEquals(findExactShastaUsdtTransfer([{ ...validTransfer, success: false }], txid, recipient), null);
  assertEquals(findExactShastaUsdtTransfer([{ ...validTransfer, block_timestamp: 0 }], txid, recipient), null);
  assertEquals(findExactShastaUsdtTransfer([validTransfer], "not-a-txid", recipient), null);
  assertEquals(findExactShastaUsdtTransfer([validTransfer], txid, "invalid-recipient"), null);
});

Deno.test("USDT decimal conversion is exact and rejects unsupported precision", () => {
  assertEquals(usdtAmountToRaw("10"), "10000000");
  assertEquals(usdtAmountToRaw("10.00"), "10000000");
  assertEquals(usdtAmountToRaw("0.000001"), "1");
  assertEquals(usdtAmountToRaw("12.345678"), "12345678");
  assertEquals(usdtAmountToRaw("0"), null);
  assertEquals(usdtAmountToRaw("-1"), null);
  assertEquals(usdtAmountToRaw("1e-6"), null);
  assertEquals(usdtAmountToRaw("1.0000001"), null);
  assertEquals(usdtAmountToRaw(Number.NaN), null);
});

Deno.test("raw chain amount must equal the requested decimal amount without float tolerance", () => {
  assertEquals(exactUsdtRawAmountMatches(validTransfer, "12.34"), true);
  assertEquals(exactUsdtRawAmountMatches(validTransfer, "12.340001"), false);
  assertEquals(exactUsdtRawAmountMatches({ ...validTransfer, value: "12340001" }, "12.34"), false);
  assertEquals(exactUsdtRawAmountMatches({ ...validTransfer, value: "0" }, "0"), false);
  assertEquals(exactUsdtRawAmountMatches({ ...validTransfer, value: "12.34" }, "12.34"), false);
});
