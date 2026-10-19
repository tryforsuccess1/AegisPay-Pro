# AegisPay Production Readiness

## Current verified snapshot — 2026-10-19

- Canonical repository: `tryforsuccess1/AegisPay-Pro`; latest verified `main` commit: `5443f27348f7b5a7b771d850457fcb4f3bc94409` (`Finalize post-merge production audit snapshot`).
- GitHub workflows all passed on this commit: [CI](https://github.com/tryforsuccess1/AegisPay-Pro/actions/runs/39176890918), [Android APKs](https://github.com/tryforsuccess1/AegisPay-Pro/actions/runs/39176890861), [Client/Admin APK Release](https://github.com/tryforsuccess1/AegisPay-Pro/actions/runs/39176890832), and [Web Portal Deploy](https://github.com/tryforsuccess1/AegisPay-Pro/actions/runs/39176890830). The Web Portal Deploy live browser smoke check passed for the landing page, Client, Master Admin, UI interactions, and legacy compatibility redirect without same-origin HTTP errors or uncaught page errors.
- Current Cloudflare Pages production deployment: `0926de10-3ac9-44f3-9bd8-7ba54681b0ed`, stage `success`, from commit `5443f27348f7b5a7b771d850457fcb4f3bc94409`. Canonical routes: https://aegispay-pro.pages.dev/app/ and https://aegispay-pro.pages.dev/admin/.
- The legacy Worker `aegispay-web-hotfix` version 5 is deployed at 100% traffic with compatibility date `2026-10-18`. The earlier future-date deployment failure is resolved.
- Current Android candidate: Build 46 / v2.6.7, release channel `test`. Automated APK builds pass; install/update and authentication still require a physical-device check.
- Supabase project `wtcspnrmsoisroavojop` reports `ACTIVE_HEALTHY`. All 21 public tables have RLS enabled; no public table in the current schema query lacked RLS. Three deposit/sweep journal tables intentionally have no client policies and deny direct `anon`/`authenticated` access.
- A fresh function inventory found 43 public `SECURITY DEFINER` functions; all have an explicit `search_path` setting, none is executable by `anon`, and nine remain executable by `authenticated` for reviewed owner-scoped Client flows. The five legacy administrative RPCs are no longer directly executable by client roles. SQL-migration and legacy SECURITY DEFINER permission tests passed on the migration-alignment commit: [SQL migration tests](https://github.com/tryforsuccess1/AegisPay-Pro/actions/runs/39176591066), [legacy RPC permission tests](https://github.com/tryforsuccess1/AegisPay-Pro/actions/runs/39176591031).
- Remaining Supabase Security Advisor findings: three informational RLS-enabled/no-policy notices on service-only deposit/sweep tables; nine warnings for client-callable SECURITY DEFINER functions; and native Auth leaked-password protection reported disabled. The custom signup/password-reset functions do check compromised passwords, but native Auth protection is a separate setting. Performance Advisor reports 20 unused-index notices; indexes were not removed without workload evidence.
- CAPTCHA remains **not fully verified**. The client Turnstile site key matches the Cloudflare account widget and the widget allowlists the canonical Pages and Android WebView domains. Auth logs contained 24 `POST /token` events with `captcha_failed` / HTTP 400 between `2026-10-18T23:01:12Z` and `2026-10-18T23:33:14Z`; the last was after the rollout timestamp. No additional `captcha_failed` entries appeared in the separately queried interval `2026-10-19T00:00:00Z`–`2026-10-19T11:26:00Z`. The matching Supabase Auth-side secret cannot be read through this audit connection, and CI uses a CAPTCHA mock. A real interactive sign-in is still required before marking CAPTCHA pass.
- Financial controls remain closed: `environment=PRE_PRODUCTION`, `live_deposits_enabled=false`, `real_payouts_enabled=false`, `go_live_approved=false`, and `payouts_locked=true`. `system_mode=MAINNET` alone does not enable transactions. Confirmed counts: zero HD deposit wallets, zero deposit submissions, zero sweep journal records/items, zero approved/processing withdrawals missing payout TXIDs, and zero open withdrawals.
- The cycle-settlement and mainnet-deposit-monitor cron jobs are active; both returned successful results at `2026-10-19 11:28 UTC`. The monitor cron evaluates the broad payment gates and safely skips dispatch while they are closed; this does not prove on-chain transaction reconciliation.
- HD deposit addressing is deployed and fail-closed. The sweep implementation is Shasta testnet-only, disabled by default, and is not a Mainnet sweep implementation. A testnet transaction lifecycle/recovery run is still required before any production-go-live decision.
- Cloudflare contains older Worker scripts `aegispay-web`, `aegispay-aurora`, and `aegispay-aurora-v2` with demo-style content and no discovered custom routes. They were not disabled or deleted because current use/ownership was not confirmed.
- GitHub repository visibility is public and `main` branch protection / required status checks are disabled. These repository-level administration controls are not writable through the connected audit tool; the repository owner must decide whether to make the repo private and enforce branch protection.
- The database migration history and canonical source are aligned for the legacy RPC restriction migration: `20261018195540_restrict_legacy_admin_definer_rpcs.sql` corresponds to live migration version `20261018195540`.
- No unverified change was made to live payment gates or sensitive wallet secrets. Owner-only prerequisites before a production-readiness claim remain: verify/save the Supabase Auth Turnstile secret pair and execute a real login; enable native leaked-password protection where available; confirm redirect/provider/SMTP settings and repository visibility/branch protection; provision isolated testnet-only resources/secrets; and complete physical-device plus controlled end-to-end deposit/KYC/Shop/settlement/withdrawal validation.

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
