# AegisPay Production Handoff

## Canonical technical baseline

- Repository: `msmgroups5/AegisPay-pro`
- Production branch: `main`
- Supabase project: `wtcspnrmsoisroavojop`
- Cloudflare Pages project: `aegispay-pro`
- Cloudflare Pages project ID: `61848c21-fc40-4436-8c89-5b46cbdcdf6a`
- Production website: `https://aegispay-pro.pages.dev/`
- Client entry: `https://aegispay-pro.pages.dev/app/`
- Master Admin entry: `https://aegispay-pro.pages.dev/admin/`
- Client APK: `https://aegispay-pro.pages.dev/downloads/aegispay-client.apk`
- Update manifest: `https://aegispay-pro.pages.dev/app-version.json`
- Android client current baseline: versionCode 38 / versionName 2.5.9

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

## Verified Supabase state on 2026-10-08

- Project status: ACTIVE_HEALTHY.
- Two Auth users exist and both are email-confirmed.
- Two application profiles are linked: one active MASTER ADMIN and one active USER.
- Private `private-verification` Storage bucket exists, public access is disabled, max size is 10 MB, and allowed MIME types are JPEG/PNG/WebP.
- Storage policies are owner-scoped and guarded by the application runtime switch.
- One active pg_cron job runs `public.settle_due_cycles()` every minute.
- Current system mode is `MAINNET / LIVE_DEPOSIT_TEST`; controlled live-deposit testing is enabled, while real payouts remain disabled and the Phase 3 production payout gate is locked.
- No Supabase development branches currently exist.
- `monitor-deposits` is deployed, but automatic chain monitoring remains intentionally disabled until the server-side cron authentication secret is securely configured.

## Security review

Supabase Security Advisor currently reports:
- The pre-auth `resolve_login_email` RPC has been revoked from public client roles; username login now uses the rate-limited `username-login` Edge Function and does not return email addresses. The remaining authenticated SECURITY DEFINER functions still need function-by-function review; they must not be blindly revoked because several support required client/admin operations.
- The stale one-argument `link_withdrawal_wallet(text)` overload is no longer executable by `authenticated`; the canonical two-argument wallet RPC is the authenticated client path.
- Leaked Password Protection is disabled and remains a production security prerequisite.

Supabase Performance Advisor currently reports 12 unused indexes. These are review candidates and should not be deleted solely because the current dataset is small.

## Production prerequisites

Before real-money use:
1. Enable leaked-password protection in Supabase Auth.
2. Verify real Master Admin identity and production Auth redirect URLs on a physical device.
3. Configure and verify required AI, Telegram and controlled Shasta/testnet payout secrets server-side.
4. Verify deposit confirmation, Shop cycle/task completion, 18-hour settlement, KYC, withdrawal dual approval and payout reconciliation end-to-end.
5. Configure production Android signing secrets and keep the same signing identity for updates.
6. Verify direct APK download and in-app SHA-256 update flow on a physical Android device.

Never place service-role keys, payout private keys, Telegram bot credentials, AI API keys or release keystore material in browser assets or Cloudflare Pages client variables.
