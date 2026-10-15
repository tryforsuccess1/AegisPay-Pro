# AegisPay Infrastructure Deep Audit

**Audit date:** 16 October 2026  
**Scope:** Supabase, GitHub Actions/repository, Cloudflare Pages and Workers  
**Canonical repository:** `tryforsuccess1/AegisPay-Pro`  
**Supabase project:** `wtcspnrmsoisroavojop`  
**Canonical web URL:** https://aegispay-pro.pages.dev/

## 1. Executive summary

AegisPay has a substantial deployed application/backend foundation, but a successful build is not the same as a production-ready financial system. This audit inspected the live Supabase configuration and logs, current database permissions/advisors, deployed Edge Functions, GitHub branch/workflow state, and Cloudflare Pages/Worker deployment metadata.

**Overall outcome:** PR #41 was merged at `6ad191b1d06744ddd6282ee49490a32e0dadcd63`, and its latest six CI/test workflows passed. Three forward-only Supabase migrations have now been applied and their schema/function/cron states re-checked. The auth redirect migration remains deferred until the Supabase Auth allowlist can be verified. No live payment flags were changed and no funds were moved.

### Main conclusions

- Supabase is reporting **ACTIVE_HEALTHY**. All 18 inspected public tables have RLS enabled; the audit found no public table with RLS disabled and no public `SECURITY DEFINER` function with an unpinned `search_path`.
- The private KYC/verification Storage bucket exists and the inspected policies scope user uploads/deletes to that user's folder. Master Admin read access is explicit.
- Supabase Auth leaked-password protection is **disabled** and should be enabled before production launch.
- Supabase Security Advisor still reports 14 authenticated-callable `SECURITY DEFINER` routines. These are review findings, not 14 proven exploitable bugs; access must be reviewed routine by routine.
- The live Mainnet payment posture is safely locked in `PRE_PRODUCTION`: live deposits false, real payouts false, go-live approval false, payout lock true.
- Before the audit fix, the deposit monitor cron job called the function every minute even while all payment gates were closed; logs showed about 1,260 HTTP 403 responses on 15 October UTC. The guarded cron migration is now applied. Its stored command was verified to contain the gate-conditional block; post-change logs should be checked again to quantify the reduction.
- Signup and reset emails currently use the legacy Worker redirect. The canonical Pages redirect migration is deferred because the connected account tools cannot read the live Supabase Auth allowlist.
- GitHub web deployment and APK-release workflows accepted manual dispatch without a branch guard. PR #41 restricts those jobs to `main` and adds static regression checks.
- There are no deposit submission records in the live DB, so a real deposit-to-credit-to-treasury-to-withdrawal journey is not proven by live evidence.
- Per-user HD deposit wallets and automatic treasury sweeping are not yet live. PR #40 remains a separate draft.

## 2. Findings by platform

## 2.1 Supabase

### Positive checks

| Check | Current finding |
|---|---|
| Project health | `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.166 |
| Public table security | 18 public tables inspected; none has RLS disabled |
| SECURITY DEFINER search path | No unpinned search path found among public SECURITY DEFINER functions |
| KYC storage | `private-verification` bucket is private; 10 MiB limit; JPEG/PNG/WebP allowed |
| Storage policies | Client upload/delete scoped to the authenticated user's folder; Master Admin read policy present |
| Runtime | `app_runtime.enabled=true` |
| Edge Functions | 17 active functions listed; sensitive financial functions include server-side auth and production/readiness guards in their current deployed code |
| Cron | Settlement and deposit monitor jobs active once per minute |

### Findings / follow-up

**S1 — Leaked-password protection disabled (production prerequisite).**  
Supabase Security Advisor reports that compromised-password checks are disabled. Enable the feature in Supabase Auth, then test signup and password reset with both known-compromised and clean test passwords. Do not treat a UI setting change alone as complete; run a regression test afterward.

**S1 — Authenticated-callable SECURITY DEFINER functions require review.**  
Security Advisor reports 14 routines executable by `authenticated`. Some are intentional client RPCs and already enforce role/status checks (for example, the production configuration RPC checks for an active Master Admin). Do not blindly revoke execution, as that could break legitimate app flows. Review each routine's body, ownership checks, grants and caller intent; tighten only functions that should be service-role-only or Master-Admin-only. Re-run Security Advisor after changes.

**Informational — `ai_support_messages` has RLS but no policies.**  
PR #41 added an explicit restrictive deny-all policy for `anon` and `authenticated`, revoked direct client privileges and preserved `service_role` access. This migration has been applied. Post-apply verification confirmed the policy is `RESTRICTIVE`, its `USING`/`WITH CHECK` are both `false`, client roles have no direct SELECT/INSERT/UPDATE/DELETE rights, and `service_role` retains access.

**S1 — Deposit cron creates repeated paused requests.**  
The `aegispay-mainnet-deposit-monitor` job remains scheduled every minute through `pg_cron`, but its stored command now wraps the `pg_net` HTTP call in checks for all broad production/deposit/payout gates. The migration was applied and `cron.job` metadata confirms the guarded command is active. The previous ~1,260 HTTP 403 responses on 15 October UTC were fail-closed behavior, not evidence of money movement. Confirm the reduction in subsequent logs after enough runtime has accumulated.

**Financial evidence is incomplete.**  
Current DB snapshot: 0 deposit submissions, 1 withdrawal request, 0 completed/paid withdrawals, 1 KYC record, 1 AI support case and 0 AI support messages. Therefore no live evidence establishes deposit verification, exactly-once ledger credit, treasury sweep, or completed payout end-to-end.

## 2.2 GitHub / CI / release workflows

### Baseline evidence

- Pre-audit `main` commit: `02e033c365ace79805bd557dd1c5b14da62def1d`. The core audit PR is now merged at `6ad191b1d06744ddd6282ee49490a32e0dadcd63`.
- Main-branch CI, Android build, APK release and web deploy runs on 15 October completed successfully.
- The production Cloudflare Pages deployment metadata points to that same main commit and shows its deploy stage succeeded.
- HD-wallet PR #40 (`feature/hd-tron-deposit-wallets`) has passing CI, SQL migration tests and Android checks at its latest reviewed SHA, but remains draft/open.
- GitHub repository rulesets API returned an empty list. The integration could not read classic branch-protection settings (403), so branch protection status is not fully verified by this audit.

### Findings / fixes delivered in merged PR #41

**S1 — Manual workflow dispatch lacked a main-branch guard.**  
The production web deployment and APK-release workflows had `workflow_dispatch` but no job-level guard restricting deployment/publication to `main`. Merged PR #41 adds `if: github.ref == 'refs/heads/main'` to both jobs and static regression checks for these guards.

**S2 — Migration test path filters were too narrow.**  
The deposit/withdrawal migration-test workflows only triggered for a small hard-coded set of migration paths. Merged PR #41 broadens the path filters to database migrations and relevant function sources. This improves test triggering, but it does **not** mean every historical migration is replayed as one complete fresh-project installation; that remains a separate validation task.

**Migration source/history reconciliation is needed.**  
At the initial audit snapshot, the repository had 80 checked-in migration files while Supabase history had 90 rows. The three newly applied audit migrations were recorded by Supabase as versions `20261015222625`, `20261015222642` and `20261015222721`. This follow-up branch aligns their repository filenames and test references to those exact recorded versions. Older historical version/source differences still need full row-by-row reconciliation; the count difference alone does not prove that a specific migration is missing.

**Release remains a test candidate.**  
Source `app-version.json` states Build 42 / v2.6.3 with `releaseChannel: test`. Published Build 42 artifacts are debug APK/AAB variants. Do not represent this as a stable signed production release until signing identity, hashes, direct download, in-app update and physical-device upgrade are verified.

## 2.3 Cloudflare

### Current observed state

- Cloudflare Pages project `aegispay-pro` exists at `https://aegispay-pro.pages.dev/`.
- The latest production deployment inspected was successful, came from branch `main`, and used the canonical main commit `02e033c...`.
- Pages has no custom domain configured in the observed project metadata; its Pages domain is `aegispay-pro.pages.dev`.
- Pages reports no Functions deployment, which matches the static-site deployment model; sensitive secrets should remain in server-side Supabase/Worker configuration, not browser assets.
- The canonical `aegispay-shopping` Worker has a 15 October deployment.
- Legacy Workers `aegispay-web`, `aegispay-aurora` and `aegispay-aurora-v2` remain enabled on their workers.dev subdomains; the older UI Workers were last deployed on 13 October and 5 October respectively. `aegispay-web-hotfix` has its subdomain disabled.
- Preview deployments were not listed for Pages. Worker previews are disabled for several UI Workers and enabled for the Shop Worker.

### Findings / fixes delivered in merged PR #41

**S1 — Auth redirect migration is deferred.**  
The current client, shared auth helper and deployed `public-signup` Edge Function retain `aegispay-web.aegispay.workers.dev` destinations. PR #41 deliberately preserves that behavior so verification/recovery links are not changed before `https://aegispay-pro.pages.dev/app/**` is confirmed in the live Supabase Auth allowlist. The connected tools cannot read that exact setting. After it is confirmed, update client and shared auth helper redirects, deploy the matching `public-signup` Edge Function separately (Cloudflare Pages does not deploy Supabase functions), then verify the deployed function version and a real email-link journey.

**Legacy Worker retirement is not yet recommended.**  
Do not disable `aegispay-web`, `aegispay-aurora` or `aegispay-aurora-v2` based only on age. First review traffic/route usage and ensure there are no old APKs, saved links or callbacks depending on them. Once zero usage is confirmed, retire or redirect them through a separately approved change.

## 3. Fixes included in audit PR #41

PR: https://github.com/tryforsuccess1/AegisPay-Pro/pull/41

1. Add a forward-only migration that suppresses deposit-monitor cron HTTP requests when broad Mainnet/deposit/payout gates are closed. Existing Edge Function checks remain authoritative when the gates are open.
2. Add disposable SQL fixtures for cron, Vault and pg_net plus assertions for closed-gate suppression, dispatch when test gates are open, Vault secret lookup, and skip behavior after a gate closes. These tests do not call the real network.
3. Harden Master Admin manual balance adjustments so reversals cannot exceed remaining manual credit or unreserved available balance, and invalid/non-finite inputs fail closed.
4. Make the service-role-only `ai_support_messages` access posture explicit, with disposable regression tests.
5. Broaden deposit and withdrawal migration-test workflow path filters and restrict production web deployment/APK publication jobs to `main`.
6. Keep auth redirect code unchanged and add static regression assertions that guard this deferral until the Supabase Auth allowlist is confirmed.

### Automated test result at latest reviewed commit

| Check | Result |
|---|---|
| AegisPay CI | PASS |
| Deposit SQL migration / cron tests | PASS |
| Withdrawal migration tests | PASS |
| Android debug APK build | PASS |

These checks passed on audit-branch SHA `443efc17411e28751a88fd68f2b6865ebd37ce91`, including repository CI/browser smoke tests, SQL/deposit cron tests, withdrawal migration tests, manual balance adjustment tests, AI support permission tests and Android client/admin build. They validate source/static and disposable-database behavior; they do not validate a real TRON transfer, the live Auth redirect allowlist, or a full real-money journey.

## 4. Remaining blockers before production

**Must complete before financial launch**
1. Complete a documented function-by-function review of authenticated `SECURITY DEFINER` routines; do not blindly revoke intentionally used client RPCs.
2. Confirm the canonical Pages verification/reset URLs are allowed in Supabase Auth before changing the current Worker redirects.
3. Finish row-by-row migration history/source reconciliation and run a clean fresh-database bootstrap. This follow-up PR aligns the three newly applied audit migration versions but does not resolve all older historical differences.
4. Enable and test Supabase Auth leaked-password protection after confirming the account-level setting in the dashboard.
5. Complete the per-user HD wallet setup and child-address-to-treasury USDT sweep, including TRX/Energy fee sponsorship, idempotency, safe retries and reconciliation. PR #40 does not implement the sweep.
6. Run controlled testnet end-to-end tests: signup/login; deposit submission; confirmed on-chain recipient/contract/amount verification; exactly-once balance and ledger credit; KYC; Shop/task/cycle completion; withdrawal approval; payout confirmation; retry/failure reconciliation.
7. Test signed stable Android builds, direct APK downloads, SHA-256 validation and in-app upgrades on a physical device.
8. Use Cloudflare deployment/traffic data to confirm whether the old public Workers can be retired or should redirect to the canonical Pages site.

**Do not unlock payments to make tests pass.**  
At audit time, production remains in `PRE_PRODUCTION`, live deposits are disabled, real payouts are disabled, go-live approval is false and the payout lock is enabled. Keep those controls in place until the above checks and explicit business sign-off are complete.

## 5. Production changes made and not made

**Applied to live Supabase and verified after application:**
- Guarded the scheduled deposit-monitor HTTP call with broad closed-gate checks; its job remains active on the existing one-minute schedule but should skip the HTTP request while gates are closed.
- Hardened `master_admin_adjust_balance` with finite/positive amount validation, manual-credit/withdrawal-hold reversal bounds and existing Master Admin authorization.
- Added the restrictive deny-all `ai_support_messages` policy and revoked direct `anon`/`authenticated` table privileges while retaining `service_role` access.

**Not changed:**
- No Supabase Edge Function was deployed by this work.
- No Cloudflare Pages or Worker deployment was intentionally changed as part of the audit.
- No live Auth configuration changed; signup/reset redirects remain on the existing Worker destination until the Pages URL allowlist is verified.
- No deposit/payout switches were unlocked, and no funds were moved.
- No physical-device test was performed.

## 6. Audit limitations

This was a deep infrastructure/configuration/source review with automated checks and sampled logs. It was not a third-party penetration test, a full proof of every UI button on a physical device, a real-money transaction test, or a guarantee that every external secret/provider is correctly configured. Some account-level settings (including the Auth redirect allowlist and classic GitHub branch-protection details) were not readable through the connected APIs. Items above are marked as pending where live proof was unavailable.
