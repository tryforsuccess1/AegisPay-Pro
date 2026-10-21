import { assertEquals } from "jsr:@std/assert@1.0.14";
import { extractUniqueTxidCandidate, sha256Hex } from "./deposit-txid.ts";

const a = "a".repeat(64);
const b = "b".repeat(64);

Deno.test("accepts one exact 64-character TXID candidate", () => {
  assertEquals(extractUniqueTxidCandidate(a), a);
  assertEquals(extractUniqueTxidCandidate("Transaction ID: " + a), a);
  assertEquals(extractUniqueTxidCandidate("TXID (" + a.toUpperCase() + ")"), a.toUpperCase());
});

Deno.test("returns null for missing, malformed or ambiguous screenshot extraction", () => {
  assertEquals(extractUniqueTxidCandidate(null), null);
  assertEquals(extractUniqueTxidCandidate(""), null);
  assertEquals(extractUniqueTxidCandidate("0x" + a), null);
  assertEquals(extractUniqueTxidCandidate("c".repeat(65)), null);
  assertEquals(extractUniqueTxidCandidate(a + " " + b), null);
  assertEquals(extractUniqueTxidCandidate("TXID " + a + " repeated " + a), a);
});

Deno.test("hashes duplicate TXID fingerprints without storing the source TXID", async () => {
  const left = await sha256Hex(a.toLowerCase());
  const right = await sha256Hex(a.toUpperCase().toLowerCase());
  assertEquals(left, right);
  assertEquals(left.length, 64);
  assertEquals(left === a, false);
});
