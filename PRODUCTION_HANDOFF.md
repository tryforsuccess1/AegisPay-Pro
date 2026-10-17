# AegisPay Production Handoff

## Canonical technical baseline

- Repository: `tryforsuccess1/AegisPay-Pro`
- Production branch: `main`
- Supabase project: `wtcspnrmsoisroavojop`
- Cloudflare Pages project: `aegispay-pro`
- Cloudflare Pages project ID: `61848c21-fc40-4436-8c89-5b46cbdcdf6a`
- Production website: `https://aegispay-pro.pages.dev/`
- Client entry: `https://aegispay-pro.pages.dev/app/`
- Master Admin entry: `https://aegispay-pro.pages.dev/admin/`
- Client APK: `https://aegispay-pro.pages.dev/downloads/aegispay-client.apk`
- Update manifest: `https://aegispay-pro.pages.dev/app-version.json`
- Android repository candidate: versionCode 42 / versionName 2.6.3 (`releaseChannel: test`); do not treat it as stable until the exact APKs and SHA-256 manifest values are published and verified.

## Source-of-truth rules

- Client source: root `client.html`
- Master Admin source: root `master-admin.html`
- Client source/runtime: root `client.html` (self-contained)
- Master Admin/shared runtime: `admin-auth.js`, `supabase-client.js`, `supabase-service.js`, `aegis-auth-redirect.js`, `app-update.js`
- Admin/shared assets: `shop-catalog.js`, `aegispay-logo.svg`, `manifest.webmanifest`, `service-worker.js`
- Cloudflare Pages `site/` files are deployment artifacts generated from these canonical sources; they are not independent application sources.
- Android client/admin flavors bundle the canonical root portals and shared assets.
- Supabase database changes are forward-only migrations under `database/migrations/`.
- Supabase Edge Function source is under `supabase/functions/`.

## Supabase operational snapshot on 2026-10-17

- Project status: ACTIVE_HEALTHY.
- HD wallet schema is present: deposit_wallets, deposit_wallet_sweeps, and deposit_wallet_sweep_items exist with RLS enabled and client-role access revoked. These new tables currently contain zero rows; no user deposit address has been issued by this rollout and no chain transfer has been executed.
- Supabase migration history contains 20261017150927 / hd_deposit_wallets_20261016120000 and 20261017150938 / hd_deposit_sweep_journal_20261017100000. The repository migration filenames and SQL test workflow were reconciled to those recorded names.
- The current production_config is PRE_PRODUCTION: live_deposits_enabled=false, real_payouts_enabled=false, and payouts_locked=true. deposit_rules still references TRON MAINNET and the official USDT contract, but the production gate remains closed. Do not direct users to send funds to a configured address unless AegisPay issues a unique authenticated address and explicitly accepts deposits.
- Deployed Edge Functions: get-deposit-address v1, sweep-deposit-wallets v1 (JWT verification off; dedicated secret header and an explicit default-off environment flag are required), submit-deposit v20, verify-deposit v16, monitor-deposits v20, and execute-payout v25. The updated endpoints fail closed under the current payment gates. No sweep cron schedule was added.
- This rollout did not set or expose any HD mnemonic, BIP-39 passphrase, testnet payout private key, or cron secret. Keep the sweep flag unset in this project; configure testnet keys only in an isolated/test project and do not reuse a personal seed phrase.
- The current Security Advisor reports 14 callable SECURITY DEFINER functions (WARN), leaked-password protection disabled (WARN), and 3 RLS-enabled tables with no client policies (INFO; the new wallet/sweep tables intentionally reject client-role access). The callable functions need role-by-role review; do not blindly revoke the required authenticated RPCs.
- The current Performance Advisor reports 20 unused-index candidates (INFO). Do not delete indexes solely because the current dataset is small.
## Production prerequisites

Before real-money use:
1. Enable leaked-password protection in Supabase Auth (not controllable through the connected Supabase tool operations used in this rollout).
2. Verify real Master Admin identity and production Auth redirect URLs on a physical device.
3. Configure and verify required AI, Telegram and dedicated Shasta/testnet secrets server-side only in an isolated test project. Keep AEGIS_ENABLE_TESTNET_SWEEP unset in production.
4. Verify deposit confirmation, Shop cycle/task completion, 18-hour settlement, KYC, withdrawal dual approval and payout reconciliation end-to-end.
5. Configure production Android signing secrets and keep the same signing identity for updates.
6. Verify direct APK download and in-app SHA-256 update flow on a physical Android device.

Never place service-role keys, payout private keys, Telegram bot credentials, AI API keys or release keystore material in browser assets or Cloudflare Pages client variables.
