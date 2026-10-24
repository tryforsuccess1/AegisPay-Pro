import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const client = readFileSync(new URL("../client.html", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
const addressFunction = readFileSync(new URL("../supabase/functions/get-deposit-address/index.ts", import.meta.url), "utf8");
const submitFunction = readFileSync(new URL("../supabase/functions/submit-deposit/index.ts", import.meta.url), "utf8");
const sweeperFunction = readFileSync(new URL("../supabase/functions/sweep-deposit-wallets/index.ts", import.meta.url), "utf8");
const monitorFunction = readFileSync(new URL("../supabase/functions/monitor-deposits/index.ts", import.meta.url), "utf8");
const perDepositMigration = readFileSync(new URL("../database/migrations/20261024143000_per_deposit_tron_addresses.sql", import.meta.url), "utf8");

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
  assert.match(serviceWorker, /aegispay-shell-v52-persist-deposit-address/);
  assert.doesNotMatch(serviceWorker, /aegispay-shell-v51-deposit-amount-ux/);
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


test("each deposit session gets a fresh idempotent address request, not the user's prior address", () => {
  assert.match(client, /return 'aegis:deposit-request:/);
  assert.match(client, /localStorage\.getItem\(storageKey\)/);
  assert.match(client, /localStorage\.setItem\(storageKey,requestId\)/);
  assert.match(client, /DEPOSIT_REQUEST_ALREADY_COMPLETED/);
  assert.match(client, /localStorage\.removeItem\(storageKey\)/);
  assert.match(client, /DEPOSIT_REQUEST_STORAGE_UNAVAILABLE/);
  assert.match(client, /persistDepositRequestId\(storageKey,requestId\)/);
  assert.match(client, /getCurrentDepositRequestDetails\(\)/);
  assert.match(client, /getMyDepositAddressDetails\(depositRequestId\)/);
  assert.match(client, /body:\{depositRequestId:requestId\}/);
  assert.match(client, /depositRequestId:depositRequestId/);
  assert.match(client, /depositRequestId:activeDepositRequestId/);
  assert.match(addressFunction, /\.eq\("deposit_request_id", requestId\)/);
  assert.doesNotMatch(addressFunction, /\.eq\("user_id", profile\.id\)\.eq\("network", network\)\.eq\("status", "ACTIVE"\)\.maybeSingle\(\)/);
  assert.match(addressFunction, /deposit_request_id: requestId/);
  assert.match(submitFunction, /\.eq\("deposit_request_id", depositRequestId\)/);
  assert.match(perDepositMigration, /DROP CONSTRAINT IF EXISTS deposit_wallets_user_network_uq/);
  assert.match(perDepositMigration, /deposit_wallets_request_id_uq/);
  assert.match(perDepositMigration, /deposit_request_id SET NOT NULL/);
  assert.match(perDepositMigration, /enforce_tron_deposit_wallet_issue_limit/);
  assert.match(perDepositMigration, /last_sweep_attempt_at timestamptz/);
  assert.match(sweeperFunction, /order\("last_sweep_attempt_at", \{ ascending: true, nullsFirst: true \}\)/);
  assert.match(sweeperFunction, /update\(\{ last_sweep_attempt_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(sweeperFunction, /TRON_SHASTA_TREASURY_PRIVATE_KEY/);
});


test("terminal deposit requests rotate safely and concurrent retries recover the assigned address", () => {
  assert.ok(addressFunction.includes('.in("status", ["VERIFIED", "REJECTED", "FAILED"])'));
  assert.ok(addressFunction.includes('const rateLimited = /DEPOSIT_ADDRESS_RATE_LIMIT/.test(errorText);'));
  assert.ok(addressFunction.includes('if (racedError) return json({ error: "Unable to recover the existing deposit request safely." }, 503);'));
  assert.ok(addressFunction.includes('.eq("deposit_request_id", requestId).limit(2)'));
  assert.ok(addressFunction.includes('code: "DEPOSIT_REQUEST_NETWORK_CHANGED"'));
  assert.ok(client.includes("if(result.status==='REJECTED')"));
  assert.ok(client.includes("try{localStorage.removeItem(depositRequestStorageKey);}catch(_){}"));
  assert.ok(client.includes("DEPOSIT_REQUEST_CRYPTO_UNAVAILABLE"));
});

test("Shasta blank-TXID discovery fallback is reachable in both user deposit flows", () => {
  assert.ok(client.includes("if(!tx&&!shastaTestnetAllowed)"));
  assert.ok(client.includes("!txidForSubmit&&!depositPendingId&&!shastaTestnetAllowed"));
  assert.ok(submitFunction.includes("if (!isShastaTestUser && !validEnteredTxid)"));
});

test("deposit monitoring separates network queues and sweeper accepts monitor-verified source", () => {
  assert.ok(monitorFunction.includes('.eq("network", "TRON MAINNET")'));
  assert.ok(monitorFunction.includes('.eq("network", "TRON TESTNET")'));
  assert.ok(sweeperFunction.includes('.in("verification_source", ["TronGrid", "TronGrid Monitor"])'));
  assert.ok(sweeperFunction.includes('["TronGrid", "TronGrid Monitor"].includes(verificationSource)'));
});
