# AegisPay Production Readiness

## Current verified snapshot — 2026-10-19

- Canonical repository: `tryforsuccess1/AegisPay-Pro`; verified `main` commit: `9cb666be1aa9060ccf664b2ff3942cdda37dcb93`.
- On that post-merge verification commit, GitHub CI, Android APK workflow, Client/Admin APK release workflow and Web Portal Deploy all passed. Live browser smoke passed for the public landing, Client Portal, Master Admin, responsive/UI interactions and deployed legacy compatibility redirect; it reported no same-origin HTTP errors or uncaught page errors. Evidence: [CI](https://github.com/tryforsuccess1/AegisPay-Pro/actions/runs/39176591067), [APK build](https://github.com/tryforsuccess1/AegisPay-Pro/actions/runs/39176591051), [APK release](https://github.com/tryforsuccess1/AegisPay-Pro/actions/runs/39176591029), [Web Portal Deploy](https://github.com/tryforsuccess1/AegisPay-Pro/actions/runs/39176591036).
- Post-merge Cloudflare Pages production deployment verified during this audit: `e341d683-6cfd-48c1-8dfb-c324e5a4014e` (stage `success`, built from the verification commit above). Canonical routes remain https://aegispay-pro.pages.dev/app/ and https://aegispay-pro.pages.dev/admin/.
- The post-merge deployment uploaded legacy Worker `aegispay-web-hotfix` version 4 with `compatibility_date=2026-10-18`; this fixed the prior deploy failure caused by the future date `2026-10-19`.
- Current generated Android candidate reported by the root manifest is Build 46 / v2.6.7, release channel `test`. APK builds passed; physical-device install/update is not covered by the automated browser or CI checks.
- Supabase project `wtcspnrmsoisroavojop` remains `ACTIVE_HEALTHY`. Reviewed public tables have RLS enabled. Three deposit/sweep tables intentionally have no client policies and deny direct `anon`/`authenticated` table access. Five legacy admin RPCs now deny direct client execution; nine client-oriented SECURITY DEFINER RPCs remain callable for reviewed owner-scoped flows and are reported by Security Advisor for function-by-function review.
- Native Supabase leaked-password protection is reported disabled by the Security Advisor. Custom server-side password breach checks exist for signup and password reset, but that does not change the native Auth setting.
- CAPTCHA remains an open verification item: Auth logs for 2026-10-18 included 24 `POST /token` responses with `captcha_failed` / HTTP 400 in the queried audit window. The Cloudflare Turnstile site key in the client matches the account widget and the canonical/WebView domains are allowlisted, but the matching secret in Supabase Auth is not readable through this audit connection. CI used a CAPTCHA mock, so real interactive Supabase CAPTCHA acceptance must not be marked passed yet.
- Payment posture is closed: `environment=PRE_PRODUCTION`, `live_deposits_enabled=false`, `real_payouts_enabled=false`, `go_live_approved=false`, and `payouts_locked=true`. `system_mode=MAINNET` alone does not enable transactions. Current row counts verified zero deposit wallets, zero deposit submissions, zero sweep journal rows/items and zero approved/processing withdrawals missing payout TXIDs.
- The cycle-settlement and mainnet-deposit-monitor cron jobs are active and the latest recorded runs on 2026-10-18 23:24 UTC succeeded. Because all deposit-related tables are empty and payment gates are closed, this does not demonstrate real on-chain reconciliation.
- HD deposit addressing is deployed and fail-closed. The sweep implementation is Shasta testnet-only, disabled by default and not a Mainnet sweeping implementation. Isolated testnet configuration, resources and transaction-level reconciliation are required before go-live.
- The repository contains older `aegispay-web`, `aegispay-aurora` and `aegispay-aurora-v2` Cloudflare Worker scripts with demo-style content and no discovered custom routes. They were not removed because current usage/ownership has not been confirmed.
- Account-owner actions still required before a production-readiness claim: verify/save the Supabase Auth Turnstile secret pairing and run a real login test; enable native leaked-password protection where available; confirm redirect/provider/SMTP settings and repository visibility/branch protection; provision isolated testnet-only secrets/resources; and complete physical-device plus controlled end-to-end deposit/KYC/Shop/settlement/withdrawal validation. No live payment gate was opened by this audit.

## Historical deployment state — 2026-10-08 (archived; superseded by the current snapshot above)

## Archived deployment snapshot — 2026-10-08 (not current)

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
