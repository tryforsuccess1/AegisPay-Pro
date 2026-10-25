'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const worker = fs.readFileSync('supabase/functions/sweep-deposit-wallets/index.ts', 'utf8');
const secrets = fs.readFileSync('supabase/functions/_shared/shasta-test-mode.ts', 'utf8');

assert.match(worker, /shastaMnemonicsAreDistinct\(HD_MNEMONIC, MAINNET_HD_MNEMONIC\)/,
  'Sweep signing must verify both HD seeds exist and differ without reading Mainnet payout key material.');
assert.match(secrets, /Boolean\(testSeed && mainnetSeed && testSeed !== mainnetSeed\)/,
  'HD-seed separation must fail closed when either seed is missing.');
assert.match(secrets, /const reusedSigner = Boolean\(testKey && mainnetKey && testKey === mainnetKey\);/,
  'The shared helper must detect reuse of the Shasta and Mainnet payout signer keys.');
assert.match(secrets, /return !reusedSeed && !reusedSigner;/,
  'The shared helper must reject reused seed phrases or payout signer keys.');
assert.match(worker, /if \(!SUPABASE_URL \|\| !SERVICE_KEY \|\| !CRON_SECRET \|\| !HD_MNEMONIC \|\| !TESTNET_PAYOUT_KEY \|\| !TRONGRID_KEY\)/,
  'Sweep execution must stop when its Shasta mnemonic, payout signer, provider key, or cron authorization is missing.');
assert.match(worker, /if \(derivedTreasury !== treasury\) return json\(\{ error: "Testnet treasury key mismatch\."/,
  'Sweep signing must fail closed unless its testnet private key maps to the configured treasury address.');

assert.match(worker, /\.select\("id,txid,raw_amount,verification_source"\)/,
  'Sweep source query must include the verification source.');
assert.match(worker, /\.eq\("status", "VERIFIED"\)\s*\.in\("verification_source", \["TronGrid", "TronGrid Monitor"\]\)/,
  'Only VERIFIED deposits from explicitly permitted TronGrid verification sources may enter the sweep source map.');
assert.match(worker, /\["TronGrid", "TronGrid Monitor"\]\.includes\(verificationSource\)/,
  'Sweep source records must be rechecked against the explicitly permitted verification-source allowlist.');
assert.match(worker, /UNVERIFIED_OR_AMOUNT_MISMATCHED_INBOUND_TRANSFER_PRESENT/,
  'Any unmatched confirmed inbound transfer must stop the sweep.');
assert.match(worker, /Deno\.env\.get\("AEGIS_ENABLE_TESTNET_SWEEP"\) === "true"/,
  'Testnet sweeps must be disabled by default.');
assert.match(worker, /if \(!TESTNET_SWEEP_ENABLED \|\| !SHASTA_TEST_MODE_ENABLED\)/,
  'Both explicit opt-in feature flags must be required.');
assert.match(worker, /const NETWORK = "TRON TESTNET"/,
  'The sweep worker network must remain pinned to Shasta.');
assert.match(worker, /const TOKEN = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs"/,
  'The sweep worker token must remain pinned to the Shasta test token.');
assert.doesNotMatch(worker, /TRON_PAYOUT_PRIVATE_KEY/,
  'The Shasta worker must not read the Mainnet payout private-key secret.');
assert.doesNotMatch(worker, /const NETWORK = "TRON MAINNET"/,
  'The sweep worker must not be switched to Mainnet.');

console.log('Shasta sweep safety checks passed: chain-only source filter, unmatched-transfer fail-closed guard, opt-in-only testnet route, and no Mainnet payout key access.');
