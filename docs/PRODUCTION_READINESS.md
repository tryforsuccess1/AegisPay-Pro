# AegisPay Production Readiness

## Current verified snapshot — 2026-10-18

This snapshot supersedes conflicting older state notes below; the prior dated notes remain as historical records.

- Canonical repository: `tryforsuccess1/AegisPay-Pro`, production branch `main`; pre-follow-up baseline: `c954eca59e368544ca6343eb1af4bef58fe1f7cb`.
- Canonical website: https://aegispay-pro.pages.dev/; client: https://aegispay-pro.pages.dev/app/; Master Admin: https://aegispay-pro.pages.dev/admin/.
- Latest verified baseline Pages deployment before this follow-up: `c000d353-6f76-4878-8535-72a3dec698e7`, stage success, commit `c954eca59e368544ca6343eb1af4bef58fe1f7cb`.
- Live Supabase project `wtcspnrmsoisroavojop` is ACTIVE_HEALTHY. The current state has eight application profiles and an active username-login endpoint.
- Payment controls remain CLOSED: `environment=PRE_PRODUCTION`, `live_deposits_enabled=false`, `real_payouts_enabled=false`, `go_live_approved=false`, `payouts_locked=true`. Although the selected system network says `MAINNET`, live deposits, real payouts and go-live approval are all false.
- `deposit_wallets` and `deposit_submissions` each contain zero records. No per-user Mainnet address has been issued and no on-chain transfer was executed. Do not enable deposits as part of this code-only work.
- The address-generation API has strict fail-closed checks and is deployed, but HD wallet secrets / matching payout signer / production readiness have not been proved. The sweep worker is Shasta-testnet-only; isolated funded testnet end-to-end tests remain pending.
- Build 43 / version 2.6.4 is a TEST candidate, not a stable signed release. The main-branch baseline CI, migration tests, Web deployment and Android build passed before the current auth follow-up.
- Owner-side prerequisites still pending: Supabase Auth dashboard CAPTCHA configuration and redirect allowlist confirmation; native leaked-password protection when available; Facebook Meta credentials/provider redirect; existing Android release signing material; physical-device validation. Connected tools do not offer a Supabase Auth settings write action, so these are not claimed as changed here.
- Remaining non-operator code follow-up is tracked in `docs/PENDING_WORK_STATUS.md` and `PRODUCTION_HANDOFF.md`; check the latest CI and production deployment before treating a new PR as released.

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
