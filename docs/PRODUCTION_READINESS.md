# AegisPay Production Readiness

## Current verified snapshot — 2026-10-18

- Canonical repository: `tryforsuccess1/AegisPay-Pro`; application code baseline verified on main `5f2106aaada22b0c3dccef537240f97db6d208f0`.
- Latest CI, SQL migration tests, withdrawal migration tests, Android build and Web Portal Deploy all passed on this commit. The browser smoke-test step passed for landing, Client and Master Admin; type checks and password/HD wallet/sweep/shop regression checks passed.
- Verified Pages deployment: `b3df2d5d-06d6-4370-9860-7c0bde9ebab4`, stage `success`; Client portal https://aegispay-pro.pages.dev/app/ and Master Admin https://aegispay-pro.pages.dev/admin/.
- The deployed production artifact, not the root source fallback, publishes a generated stable Build 43 / 2.6.4 manifest with exact Client SHA-256 `78170d3ece8dc62221113361b7426538132deee4cde543b94c63b835f0156663` and Master Admin SHA-256 `ff4fb0683a8b9f88d884f2191a76454ed9638e420122bc09a7900673528193ee`. Both hashes match the delivered APKs and their alias copies. The signing certificate fingerprint matches the prior Build 42 release; physical-device install/update remains untested.
- Supabase `username-login` is ACTIVE v9 with separate safe handling for CAPTCHA/rate-limit errors and generic wrong-credential responses.
- Supabase project remains ACTIVE_HEALTHY. Security Advisor still reports 14 authenticated-callable SECURITY DEFINER routines (source-reviewed and retained intentionally, not automatically revoked), 3 RLS-enabled service-only deposit/sweep tables without client policies, and native leaked-password protection disabled. The last finding is a production security prerequisite; the table-policy INFO findings are intentional service-role-only isolation.
- Payment posture is deliberately closed: `environment=PRE_PRODUCTION`, live deposits disabled, real payouts disabled, go-live approval false and payout lock true. `system_mode=MAINNET` does not mean payments are enabled. Latest counts are zero `deposit_wallets`, zero `deposit_submissions`, zero sweep journal rows and zero unresolved approved withdrawals.
- The HD address API is deployed and fails closed without the required secure configuration. The sweep worker is Shasta testnet-only; dedicated isolated test secrets, funded test resources and transaction-level E2E reconciliation still need owner-side setup and verification before any production go-live.
- Still requires account-owner action: native Supabase Auth Turnstile/CAPTCHA and minimum password length 12, redirect allowlist, leaked-password protection where available, valid Meta credentials for optional Facebook OAuth, and physical Android verification. No live payment gate was enabled by this work.

## Historical deployment state — 2026-10-08


## Verified deployment state — 2026-10-08

- GitHub repository: `msmgroups5/AegisPay-pro`
- Production source branch: `main`
- Cloudflare Pages project: `aegispay-pro`
- Supabase project: `wtcspnrmsoisroavojop`, ACTIVE_HEALTHY
- Public website route: `/`
- Client portal route: `/app/`
- Master Admin route: `/admin/`
- Client APK route: `/downloads/aegispay-client.apk`

## Source-of-truth alignment

- Client portal source is root `client.html`.
- Master Admin source is root `master-admin.html`.
- Shared browser assets are rooted at the repository top level.
- `site/` is the Cloudflare Pages publish package; `site/app/index.html` mirrors `client.html`.
- The Cloudflare Pages workflow copies the canonical root client/admin/runtime assets into the publish package on every build.
- Android client/admin flavors bundle the same canonical root portal files.
- No alternate React/Vite client, demo REST backend, preview site, or legacy UniApp/Huawei web runtime remains in `main`.

## Supabase verified state

- RLS is enabled on the application tables.
- Two Auth users exist and both are email-confirmed.
- Two AegisPay profiles are linked: one active MASTER ADMIN and one active USER.
- `private-verification` Storage bucket is present, private, limited to 10 MB, and restricted to JPEG/PNG/WebP.
- Storage access policies are owner-scoped and runtime-gated.
- One active cycle-settlement cron runs every minute.
- Current system mode is `MAINNET / LIVE_DEPOSIT_TEST`.
- Controlled live-deposit testing is enabled; real payouts remain disabled by the Phase 3 server-side payout gate.
- Master Admin Production Readiness diagnostics and configuration controls are live.
- No Supabase development branches exist.

## Security review

The pre-auth `resolve_login_email` RPC was removed from anon/authenticated grants on 2026-10-09 because it returned registered emails from usernames. Username login now uses the `username-login` Edge Function: it performs a generic credential check server-side, rate-limits attempts and returns session tokens only after password verification. The reviewed authenticated SECURITY DEFINER RPCs still require function-by-function review; `get_production_readiness` and `set_production_config` are Master Admin-gated despite authenticated EXECUTE grants. The stale one-argument `link_withdrawal_wallet(text)` overload remains unavailable to client roles.

Leaked Password Protection is still disabled and is a production prerequisite.

Public table grants were hardened to least privilege on 2026-10-03:
- sensitive tables no longer grant write privileges to `anon` or `authenticated`;
- client-readable tables are SELECT-only;
- notifications retain UPDATE for read-state changes;
- Shop offers and platform settings retain only the authenticated operations required by the Master Admin UI.

## Performance review

Supabase Performance Advisor reports 12 currently unused indexes. With the present small dataset, these are review candidates, not automatic deletion targets. Do not remove an index solely because it has not yet been used.

## Current production blockers

1. Operator-side: enable Leaked Password Protection in Supabase Auth when available on the current plan.
2. Configure and verify the required server-side TRONGrid, monitoring, AI, Telegram and payout secrets for the intended production network.
3. Complete controlled end-to-end verification for deposit evidence, on-chain confirmation, Shop/tasks, 18-hour settlement, KYC and withdrawal dual approval before changing the Phase 3 environment to PRODUCTION.
4. Verify production Auth redirect/provider/SMTP settings on a physical client device.
5. Configure release signing and perform physical APK update verification.
