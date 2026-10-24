import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const client = readFileSync(new URL("../client.html", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");

test("embedded QR encoder produces a valid SVG for a TRON wallet without network access", () => {
  const start = client.indexOf("var qrcode = function()");
  const end = client.indexOf("\nconst qrSvg=(address)=>", start);
  assert.ok(start >= 0 && end > start, "embedded QR library boundaries must exist");
  const sandbox = {};
  runInNewContext(client.slice(start, end), sandbox, { timeout: 1000 });
  assert.equal(typeof sandbox.qrcode, "function");
  const code = sandbox.qrcode(0, "M");
  code.addData("TPXkczErK2Bo66MMU9HxYvnPFqB6mGYTTJ", "Byte");
  code.make();
  const svg = code.createSvgTag(5, 4);
  assert.match(svg, /<svg\b/);
  assert.match(svg, /viewBox="0 0 [1-9]\d* [1-9]\d*"/);
  assert.doesNotMatch(svg, /NaN|undefined/);
});

test("service-worker cache version is bumped so deployed deposit UI fixes reach mobile clients", () => {
  assert.match(serviceWorker, /aegispay-shell-v51-deposit-amount-ux/);
  assert.doesNotMatch(serviceWorker, /aegispay-shell-v50-deposit-claude-refresh/);
});

test("deposit QR is generated locally without an external QR image service", () => {
  assert.match(client, /const qrSvg=\(address\)=>/);
  assert.match(client, /qrcode\(0,'M'\)/);
  assert.match(client, /const qrDataUrl=\(address\)=>'data:image\/svg\+xml;charset=UTF-8,'\+/);
  assert.doesNotMatch(client, /api\.qrserver\.com/);
});

test("deposit TXID fallback exists and is used only when automatic extraction has no candidate", () => {
  assert.match(client, /id="manualTxid"/);
  assert.match(client, /id="manualTxidStatus"/);
  assert.match(client, /TXID length:/);
  assert.match(client, /else updateDepositSubmitAvailability\(\)/);
  assert.match(client, /manualTxid.onpaste/);
  assert.match(client, /submitDep\.disabled=false/);
  assert.match(client, /amountSessionKey/);
  assert.match(client, /sessionStorage\.setItem\(amountSessionKey/);
  assert.match(client, /if\(!initialDepositAmount&&shastaTestnetAllowed\)initialDepositAmount='100'/);
  assert.match(client, /const amount=Number\(depAmount\.value\)/);
  assert.match(client, /TXID format valid/);

  assert.match(client, /setManualTxidFallback\(true\)/);
  assert.match(client, /const txidForSubmit=depositScannedTxid\|\|manualTxidValue\(\)/);
  assert.match(client, /txid:txidForSubmit/);
  assert.match(client, /\^\[a-f0-9\]\{64\}\$/i);
  assert.match(client, /Deposit request submitted\. Checking the confirmed TRON blockchain/);
});
