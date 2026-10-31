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
const verifyFunction = readFileSync(new URL("../supabase/functions/verify-deposit/index.ts", import.meta.url), "utf8");
const depositCreditMigration = readFileSync(new URL("../database/migrations/20261024175706_harden_deposit_credit_single_pending_wallet_20261024.sql", import.meta.url), "utf8");
const perDepositMigration = readFileSync(new URL("../database/migrations/20261024144103_per_deposit_tron_addresses_20261024.sql", import.meta.url), "utf8");
const monitorRotationMigration = readFileSync(new URL("../database/migrations/20261024173503_deposit_monitor_queue_rotation_20261024.sql", import.meta.url), "utf8");
const shastaTestModeSource = readFileSync(new URL("../supabase/functions/_shared/shasta-test-mode.ts", import.meta.url), "utf8");
const mainnetSweeperFunction = readFileSync(new URL("../supabase/functions/sweep-mainnet-deposit-wallets/index.ts", import.meta.url), "utf8");

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
  assert.match(serviceWorker, /aegispay-shell-v58-activity-description-privacy/);
  assert.doesNotMatch(serviceWorker, /aegispay-shell-v52-persist-deposit-address/);
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
  assert.match(sweeperFunction, /shastaMnemonicsAreDistinct\(HD_MNEMONIC, MAINNET_HD_MNEMONIC\)/);
  assert.doesNotMatch(sweeperFunction, /TRON_MAINNET_TREASURY_PRIVATE_KEY|TRON_PAYOUT_PRIVATE_KEY|MAINNET_PAYOUT_KEY/);
  assert.match(addressFunction, /!seedsDistinct \|\| !payoutKeysPresentAndDistinct \|\| !shastaSecretsAreDistinct\(/);
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
  assert.match(monitorFunction, /\.order\("monitor_last_attempt_at", \{ ascending: true, nullsFirst: true \}\)/);
  assert.ok(monitorFunction.includes('update({ monitor_last_attempt_at: new Date().toISOString() })'));
  assert.ok(monitorRotationMigration.includes("ADD COLUMN IF NOT EXISTS monitor_last_attempt_at timestamptz"));
  assert.ok(monitorRotationMigration.includes("deposit_submissions_monitor_rotation_idx"));
  assert.ok(sweeperFunction.includes('.in("verification_source", ["TronGrid", "TronGrid Monitor"])'));
  assert.ok(sweeperFunction.includes('["TronGrid", "TronGrid Monitor"].includes(verificationSource)'));
});


test("Shasta/Mainnet HD mnemonic separation requires both configured seeds and normalized whitespace", () => {
  assert.match(shastaTestModeSource, /export function shastaMnemonicsAreDistinct\(/);
  assert.match(shastaTestModeSource, /split\(\/\\s\+\/\)/);
  assert.match(shastaTestModeSource, /Boolean\(testSeed && mainnetSeed && testSeed !== mainnetSeed\)/);
});


test("sweep reconciliation fetches an explicit Shasta receipt before treating a saved tx as expired", () => {
  assert.ok(sweeperFunction.includes("getTransactionInfoForReconciliation(client, txid)"));
  assert.ok(sweeperFunction.includes('HOST + "/wallet/gettransactioninfobyid"'));
  assert.ok(sweeperFunction.includes('body: JSON.stringify({ value: txid })'));
});

test("testnet sweep requires its dedicated vault-backed secret and never accepts the monitor cron token", () => {
  assert.doesNotMatch(sweeperFunction, /AEGIS_CRON_SECRET|environmentSecretMatches/);
  assert.ok(sweeperFunction.includes('const suppliedSecret = req.headers.get("x-aegis-cron-secret")'));
  assert.ok(sweeperFunction.includes('admin.rpc("verify_testnet_sweep_cron_secret", { p_token: suppliedSecret })'));
  assert.ok(sweeperFunction.includes('if (secretError || secretMatches !== true) return json({ error: "Unauthorized." }, 401)'));
  assert.ok(sweeperFunction.includes('if (!TESTNET_SWEEP_ENABLED || !SHASTA_TEST_MODE_ENABLED)'));
  assert.ok(sweeperFunction.includes("mainnetSweepEnabled: false"));
});

test("Shasta fallback fails closed when the confirmed-transfer provider page is capped", () => {
  assert.match(verifyFunction, /if \(transfers\.length >= 200\)[\s\S]{0,220}SHASTA_TRANSFER_PAGE_CAPPED/);
  assert.match(monitorFunction, /if \(rows\.length >= 200\) return \{ id: deposit\.id, status: "SHASTA_TRANSFER_PAGE_CAPPED" \}/);
});

test("one unresolved submission per deposit wallet is enforced in code and database", () => {
  assert.ok(submitFunction.includes('.eq("deposit_wallet_id", depositWallet.id).eq("status", "PENDING_VERIFICATION")'));
  assert.ok(submitFunction.includes('code: "DEPOSIT_REQUEST_ALREADY_PENDING"'));
  assert.ok(submitFunction.includes("/deposit_submissions_one_pending_per_wallet_uq/"));
  assert.ok(depositCreditMigration.includes("deposit_submissions_one_pending_per_wallet_uq"));
  assert.ok(depositCreditMigration.includes("shasta_testnet_rules"));
  assert.ok(depositCreditMigration.includes("network differs from current settings"));
});


test("treasury settings remain server/admin-only and deposit responses expose only request-scoped address data", () => {
  const treasuryPrivacyMigration = readFileSync(new URL("../database/migrations/20261029210000_hide_treasury_from_authenticated_clients.sql", import.meta.url), "utf8");
  assert.match(treasuryPrivacyMigration, /DROP POLICY IF EXISTS settings_authenticated_read ON public\.platform_settings/i);
  assert.match(treasuryPrivacyMigration, /key = 'app_runtime'/i);
  assert.match(treasuryPrivacyMigration, /private\.current_app_role\(\) = 'MASTER ADMIN'/i);
  assert.doesNotMatch(treasuryPrivacyMigration, /key = ANY\s*\(ARRAY\[[^\]]*deposit_rules/i);
  assert.match(client, /\.from\('platform_settings'\)\.select\('key,value_json'\)\.eq\('key','app_runtime'\)/);
  assert.doesNotMatch(client, /settings\.deposit_rules/);
  assert.doesNotMatch(client, /settings\.system_mode/);
  assert.doesNotMatch(client, /settings\.production_config/);
  assert.doesNotMatch(addressFunction, /derivationPath/);
  assert.match(addressFunction, /return json\(\{ address: inserted\.address, network, tokenContract: inserted\.token_contract, depositRequestId: inserted\.deposit_request_id, depositWalletId: inserted\.id, created: true \}\)/);
  assert.doesNotMatch(addressFunction, /return json\(\{[^}]*treasury\s*:/s);
});


test("Mainnet deposit sweep is independently gated, treasury-validated, and journal/reconciliation-backed", () => {
  assert.match(mainnetSweeperFunction, /AEGIS_ENABLE_MAINNET_SWEEP.*=== "true"/);
  assert.match(mainnetSweeperFunction, /MAINNET_SWEEP_DISABLED/);
  assert.match(mainnetSweeperFunction, /TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t/);
  assert.match(mainnetSweeperFunction, /https:\/\/api\.trongrid\.io/);
  assert.match(mainnetSweeperFunction, /verify_deposit_monitor_cron_secret/);
  assert.match(mainnetSweeperFunction, /production\.payouts_locked === false/);
  assert.match(mainnetSweeperFunction, /mode\.real_payouts === true/);
  assert.match(mainnetSweeperFunction, /mode\.live_deposits === true/);
  assert.match(mainnetSweeperFunction, /TREASURY_KEY_MISMATCH/);
  assert.match(mainnetSweeperFunction, /WITHDRAWAL_PAYOUT|deposit_wallet_sweep_items/);
  assert.match(mainnetSweeperFunction, /deposit_wallet_sweeps/);
  assert.match(mainnetSweeperFunction, /FAILED_REVIEW/);
  assert.doesNotMatch(mainnetSweeperFunction, /api\.shasta\.trongrid\.io/);
  assert.doesNotMatch(mainnetSweeperFunction, /TRON_SHASTA_TREASURY_PRIVATE_KEY|TRON_TESTNET_PAYOUT_PRIVATE_KEY/);
});
