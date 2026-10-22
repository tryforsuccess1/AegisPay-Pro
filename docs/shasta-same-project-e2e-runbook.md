# Same-Project TRON Shasta Deposit E2E Runbook

## Latest independently checked snapshot — 2026-10-22

- Current synchronized work is in draft [PR #109](https://github.com/tryforsuccess1/AegisPay-Pro/pull/109), branch `feat/shasta-step2-main-sync-20261022`. It was created from the current `main` and is zero commits behind. It preserves the latest Client screenshot-scanning and auth/session-isolation changes.
- PR #89 is the older, unsynchronized predecessor. Do not merge it; after the new PR’s final checks finish, close it as superseded.
- The Shasta-specific Cloudflare Pages preview is `https://shasta-test-ui.aegispay-pro.pages.dev`. The latest completed preview run on the synced branch passed repository checks, Turnstile-host validation, preview deployment, Client UI smoke tests, and Master Admin review-control smoke tests. The latest exact-source rerun after a non-behavioral scanner warning-text alignment is in progress.
- Live `sweep-deposit-wallets` was redeployed as v18 on 2026-10-22 12:11 UTC from the reviewed branch. Its entrypoint and all four bundled `_shared` dependencies were re-fetched and compared byte-for-byte with this branch; all five files match exactly. Existing `verify-deposit` v35, `monitor-deposits` v39, `submit-deposit` v40, `get-deposit-address` v16, and `scan-deposit-txid` v2 entrypoints also matched in the last direct comparison. Deployment did not invoke the sweep function; no transaction was signed or broadcast. Do not enable the sweep flag as part of deployment.
- The latest completed read-only Shasta resource preflight (2026-10-22 around 12:06 UTC) reported 30.000000 USDT, 0.000000 TRX, 0 available Energy, confirmed inbound history `OK`, and three inbound transfers totaling 30 USDT. Resource policy was `NOT_READY`; no transaction was signed or broadcast. Commit `dc2ce88` hardened `scripts/shasta-resource-preflight.cjs`: each inbound transfer now reports its public sender address and validates the pinned token's six decimals/type. Crucially, this resource-only script now always emits `SWEEP_POSSIBLE=NO` and explicitly reports source reconciliation and secret separation as unchecked; a chain-resource check must never be mistaken for sweep approval. The amended script's latest output still needs to be run to identify the two unmatched transfers' senders.
- The current database has two Shasta-labelled `VERIFIED` rows and two matching `USER_DEPOSIT` ledger credits totaling 20 USDT: one genuine TronGrid-confirmed 10 USDT chain transfer with TXID, and one separate Master Admin test credit without TXID/raw amount/block timestamp. The manual credit is an app-ledger test credit—not evidence of an on-chain transfer—and must never be treated as a verified chain source. The wallet's current on-chain history shows three confirmed inbound 10 USDT transfers (30 USDT total), but only one has a genuine verified submission row; the other two TXIDs remain unmapped. The account's current `current_platform_balance` is 45.36 and `principal_balance` is 20.00. Do not fabricate a TXID, create a speculative credit, edit the balance, or sweep any unmatched transfer to make the totals align.
- Both sweep tables are empty (`deposit_wallet_sweeps=0`, `deposit_wallet_sweep_items=0`), and no cron job referencing `sweep-deposit-wallets` exists. No sweep has been invoked.
- The Mainnet payment switches remain fail-closed: `system_mode=MAINNET`, live deposits and real payouts are false, production approval is false, environment is `PRE_PRODUCTION`, and `payouts_locked=true`.
- Still pending before a controlled sweep: a fresh unique TXID-less on-chain runtime test; independent verification that Shasta mnemonic/private key are present and distinct from Mainnet; fresh child-wallet TRX, USDT, and Energy/resource checks; then controlled sweep, TXID/idempotency/retry verification, and ledger reconciliation. Connected read-only tools cannot disclose secret presence or query the required live Shasta balances/resources through the available connector path.
- Do not enable `AEGIS_ENABLE_TESTNET_SWEEP=true` until the guarded manual sweep window and preflight are explicitly ready. Do not create a production sweep cron or open Mainnet deposit/payout/go-live gates.

## Historical snapshot — 2026-10-20


Status as of 2026-10-20:
- Draft PR: https://github.com/tryforsuccess1/AegisPay-Pro/pull/89
- Current branch: `feat/step2-shasta-deposit-e2e`
- The additive database migrations `harden_shasta_deposit_credit_20261020` and `isolate_shasta_test_credit_side_effects_20261021` have been applied to the existing Supabase project after CI and disposable PostgreSQL assertions passed.
- Global `deposit_rules` is still Mainnet. `shasta_test_users` exists but is empty; `shasta_testnet_rules` is not set.
- Shasta treasury config is saved, the owner-approved profile is allowlisted, and the reviewed deposit/monitor/sweep Edge Functions have been deployed. The per-user Shasta child wallet has been issued. The first 10.00 USDT deposit E2E is complete and server-verified; exactly one ledger credit was recorded. No sweep has been executed yet.
- The payment switches remain in pre-production safe state; do not change them for this test.

## 1. Preflight and required secrets

Use the existing Supabase project only, but keep Shasta segregated:
- Generate a brand-new TRON HD mnemonic offline for test use only. Never reuse the Mainnet seed.
- Create a dedicated Shasta treasury private key. Derive its TRON address locally and verify it matches the address configured below. Do not use the Mainnet treasury address or signer.
- Obtain only testnet TRX/USDT through appropriate Shasta testnet funding mechanisms.
- In Supabase Dashboard > Edge Functions > Secrets, configure:
  - `AEGIS_SHASTA_TEST_MODE=true`
  - `TRON_TESTNET_HD_WALLET_MNEMONIC` (new test seed)
  - `TRON_TESTNET_HD_WALLET_PASSPHRASE` (optional, if generated/used)
  - `TRON_TESTNET_PAYOUT_PRIVATE_KEY` (dedicated testnet treasury signer)
  - Verify the existing `TRONGRID_API_KEY`, `AEGIS_CRON_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are available to the relevant functions.
- Never paste mnemonic/private keys/service-role keys into chat, SQL, client code, repo files or logs.
- Do not set `AEGIS_ENABLE_TESTNET_SWEEP=true` until a reviewed manual sweep is actually about to be tested. Never add a production cron for the sweep worker.

## 2. Configure separate Shasta treasury settings

Derive the address from `TRON_TESTNET_PAYOUT_PRIVATE_KEY` offline. Then set only the test-specific key, substituting the derived public address locally:

```sql
INSERT INTO public.platform_settings(key, value_json)
VALUES (
  'shasta_testnet_rules',
  jsonb_build_object(
    'network', 'TRON TESTNET',
    'token_contract', 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
    'receiving_address', '<DERIVED_SHASTA_TREASURY_ADDRESS>'
  )
)
ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json;
```

Before proceeding verify:
- The configured address is derived from the dedicated Shasta private key.
- It is a valid TRON address and is not the Mainnet treasury.
- `deposit_rules` still says `TRON MAINNET` and still references the official Mainnet USDT contract.
- `system_mode` is still `MAINNET`, with live deposits, real payouts and go-live approval false.
- `production_config` is still `PRE_PRODUCTION`, with live deposits, real payouts and go-live approval false, and `payouts_locked=true`.

The Shasta helper fails closed when these conditions do not hold.

## 3. Owner-approved test profile

- The owner approved using an existing active AegisPay profile rather than creating a separate synthetic user for this run.
- The profile has an existing app balance and has been enabled in `public.shasta_test_users`; do not copy its UUID into source code or commit it to this runbook.
- A successful Shasta test credit will increase that profile's `current_platform_balance` and `principal_balance`. The test-specific credit RPC now preserves `first_deposit_done` and `selected_tier_id` and skips L1/L2 referral rewards for `TRON TESTNET`.
- Live withdrawals remain locked. After the E2E, reconcile the testnet-labelled deposit and ledger entries and decide whether to reverse the test credit through the authorized, audited reversal workflow so the app balance is not mistaken for Mainnet funds.
- Do not create another allowlist row unless the owner explicitly changes the test identity.

## 4. Deploy and test

After the config and test user are verified:
1. Deploy the reviewed branch versions of `get-deposit-address`, `submit-deposit`, `monitor-deposits`, `verify-deposit`, and `sweep-deposit-wallets`, including each function's relative `_shared` dependencies. Keep JWT verification enabled where the existing endpoint requires it.
2. Confirm a test user's address is idempotent and a second synthetic account (if needed) gets a different child address. Non-allowlisted accounts must not receive a Shasta address.
3. Submit a minimum-valid testnet deposit (10 USDT) using the test user and its normal authenticated UI/API flow; provide the receipt image through normal private storage and the confirmed Shasta TXID.
4. Verify exact pinned contract, exact six-decimal raw amount, receiver address, sender address, timestamp, confirmation policy and assigned child wallet.
5. Confirm one and only one deposit ledger credit, and reconcile the submission row, chain transaction, user balance, principal balance, `account_ledger` and deposit history.
6. Exercise negative cases: wrong contract, wrong receiver, wrong raw amount, unallowlisted user, missing test-mode secret, open payment gate and duplicate TXID. Each must fail closed and create no extra credit.
7. For sweep tests, first confirm each child wallet has the required Shasta TRX/Energy resources. Temporarily enable `AEGIS_ENABLE_TESTNET_SWEEP=true` only for the manual test window, invoke the worker manually with the cron secret, then disable the flag again. Verify saved signed bytes/TXID are reused on retry and ambiguous receipts are sent to manual review.
8. Reconcile the sweep journal, child/treasury balances, source deposit links and final ledger. Disable the allowlist row and `AEGIS_SHASTA_TEST_MODE` when finished; retain records for audit.

## First completed deposit: evidence and reconciliation

- Status: `VERIFIED` / review `APPROVED` (`CHAIN_VERIFIED_SHASTA_TRANSFER`).
- Network: `TRON TESTNET`; pinned contract: `TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs`.
- TXID: `ad5ee7961b0a811dc60940a2d0d5162f74826060205a637dc6706b667ebc8ef1`.
- Receiving child wallet: `TPXkczErK2Bo66MMU9HxYvnPFqB6mGYTTJ`; sender/treasury: `TH7NgA7G17X4hm88SPL9TPptnmsSx7PbMR`.
- Raw amount `10000000` = `10.00 USDT`; confirmed block timestamp and TronGrid verification source were recorded.
- Ledger reconciliation: exactly one `USER_DEPOSIT` row for `10.00` references the deposit; profile balance moved from `25.36` to `35.36`; `principal_balance=10.00`.
- Mainnet first-deposit entitlement remains false; selected tier remains `T1`; no testnet referral reward was created.
- Mainnet live-deposit, real-payout and go-live flags remain false, PRE_PRODUCTION remains set, and payouts remain locked.
- Deposit path is complete. **Sweep/recovery/idempotent retry verification is still pending**; do not run a sweep or enable a production cron until separate preflight/approval.

## Stop conditions

Stop and do not broadcast or credit anything if the Mainnet and Shasta signers/seeds cannot be independently proven distinct, the derived Shasta treasury does not match its signer, the separate Shasta setting is missing, the payment gates drift from their safe values, an unexpected inbound transfer appears, or the sweep receipt is ambiguous.

No Mainnet deposit or payout flag may be opened as a workaround.
