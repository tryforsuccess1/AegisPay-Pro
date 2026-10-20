# Same-Project TRON Shasta Deposit E2E Runbook

Status as of 2026-10-20:
- Draft PR: https://github.com/tryforsuccess1/AegisPay-Pro/pull/89
- Current branch: `feat/step2-shasta-deposit-e2e`
- The additive database migration `harden_shasta_deposit_credit_20261020` has been applied to the existing Supabase project after CI and disposable PostgreSQL assertions passed.
- Global `deposit_rules` is still Mainnet. `shasta_test_users` exists but is empty; `shasta_testnet_rules` is not set.
- No Shasta test secrets, test account, deposit wallet or transfer have been configured/created yet.
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

## 3. Create one synthetic test account

- Sign up a new disposable test user through the normal app/auth flow. Do not repurpose any real customer account.
- Ensure it has no real funds, deposit history, referrer or downstream users.
- Find the associated `public.users.id` for that newly created account through an authorized project-admin query; use that profile ID (not the Auth ID) in the allowlist.
- Insert the allowlist row only after secrets/config are ready:

```sql
INSERT INTO public.shasta_test_users(user_id, enabled, purpose)
VALUES ('<PUBLIC_USERS_PROFILE_UUID>'::uuid, true, 'Shasta E2E test account')
ON CONFLICT (user_id) DO UPDATE
  SET enabled = true, purpose = 'Shasta E2E test account',
      updated_at = now();
```

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

## Stop conditions

Stop and do not broadcast or credit anything if the Mainnet and Shasta signers/seeds cannot be independently proven distinct, the derived Shasta treasury does not match its signer, the separate Shasta setting is missing, the payment gates drift from their safe values, an unexpected inbound transfer appears, or the sweep receipt is ambiguous.

No Mainnet deposit or payout flag may be opened as a workaround.
