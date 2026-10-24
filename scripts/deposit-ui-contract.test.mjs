import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../client.html", import.meta.url), "utf8");

test("deposit QR is generated locally without an external QR image service", () => {
  assert.match(client, /const qrSvg=\(address\)=>/);
  assert.match(client, /qrcode\(0,'M'\)/);
  assert.match(client, /const qrDataUrl=\(address\)=>'data:image\/svg\+xml;charset=UTF-8,'\+/);
  assert.doesNotMatch(client, /api\.qrserver\.com/);
});

test("deposit TXID fallback exists and is used only when automatic extraction has no candidate", () => {
  assert.match(client, /id="manualTxid"/);
  assert.match(client, /setManualTxidFallback\(true\)/);
  assert.match(client, /const txidForSubmit=depositScannedTxid\|\|manualTxidValue\(\)/);
  assert.match(client, /txid:txidForSubmit/);
  assert.match(client, /\^\[a-f0-9\]\{64\}\$/i);
  assert.match(client, /Deposit request submitted\. Checking the confirmed TRON blockchain/);
});
