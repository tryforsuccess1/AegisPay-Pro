# AegisPay Pending Work Status

Last aligned: 2026-10-09

## Current status

### Completed / implemented
- Canonical client portal is wired to Supabase Auth and the AegisPay runtime.
- Client flows exist for login, signup, password reset, home, top-up/deposit, withdrawal, KYC, referral, activity/history, assets/profile, tasks, AI Bot and Shop.
- Master Admin portal source and protected admin runtime exist.
- Supabase production project is ACTIVE_HEALTHY.
- Public application tables are RLS-enabled.
- Required Edge Functions are deployed and active.
- Withdrawal wallet locking and Master Admin wallet-change flow exist.
- Shop is deployed as the separate `aegispay-shopping` Worker.
- AI Bot chat layout is implemented.
- Shop UI has Amazon-style visual treatment, touch horizontal category scrolling and the current product catalog pipeline.

### Verified in this work session
- Security hardening of exposed SECURITY DEFINER RPC grants.
- Added and applied migration:
  `database/migrations/20261005_security_rpc_grants_hardening.sql`
- Anonymous execution exposure for `admin_set_withdrawal_wallet` and `link_withdrawal_wallet` was removed.
- Live RPC drift was corrected: the canonical two-argument `link_withdrawal_wallet(text,text)` is now executable by `authenticated`, while the stale one-argument overload is no longer executable by client roles.
- Security Advisor now shows 8 intentional authenticated SECURITY DEFINER findings plus the leaked-password protection warning.
- Leaked-password protection is still disabled and remains a production security gate.
- Master Admin wallet changes were moved from direct RPC execution to the authenticated `admin-account-ops` Edge Function (v2).
- `admin_set_withdrawal_wallet(uuid,text)` EXECUTE was revoked from `authenticated`; direct client RPC access is now blocked.
- Authenticated client smoke-check confirmed the current user resolves to app role `USER`, sees only the expected RLS-scoped user row, and can read the Shop catalog/runtime settings.
- Leaked-password protection is deferred by operator decision because it is not available on the current plan; it is not being treated as an active Phase 1 task for now.
- Deep cross-platform audit on 2026-10-09: GitHub canonical source, Cloudflare Worker embedded assets, and the 14 deployed Supabase Edge Function entrypoints (including KYC/deposit review helper files) were compared; all audited active Worker assets and Edge Function source files now match their current repository copies, except the intentionally enhanced active public-signup function was brought into GitHub source to remove source/runtime drift.
- Fixed a missing brace in the client Shop purchase-return branch; extended static validation to syntax-parse inline scripts in client and Master Admin HTML.
- Added and applied forward-only migrations `20261009_harden_shop_task_account_state` and `20261009_harden_shop_task_product_and_runtime`. Shop purchase confirmation/task completion now enforce active client role/status, temporary freeze and global runtime pause; purchase confirmation fails closed if the task's assigned product cannot be resolved; full-cycle checkout honors the global runtime pause.
- Security audit fix: deployed `username-login` Edge Function (v1), moved client/shared-helper username login to that protected server-side auth flow, and applied `20261009_retire_public_username_email_lookup`. Anonymous/authenticated/service-role `EXECUTE` on `resolve_login_email(text)` is now revoked; a live SQL privilege check returned false for all three roles. Supabase Security Advisor no longer reports the anonymous SECURITY DEFINER email lookup; 15 authenticated SECURITY DEFINER findings remain and leaked-password protection remains disabled by plan decision.
- Android source is configured for Build 39 / 2.6.0, but the public update manifest and last actually published APK are still Build 38 / 2.5.9 until a fresh APK is produced and its SHA-256 can be recorded. Do not advertise Build 39 before that artifact exists.
- GitHub Actions runs for CI, web deployment and Android builds are still failing before steps start (`steps: []`, missing log blob) across Ubuntu and Windows runner labels. This is an unresolved GitHub hosted-runner/account-side blocker; an actual fresh APK is not yet verified.
- Function-by-function review found the remaining 8 authenticated SECURITY DEFINER findings are intentionally used by client/admin workflows and have explicit role/authentication gates; no unauthenticated execution was retained for those reviewed functions.
- RPC/RLS privilege smoke-check confirmed: anonymous users cannot select client users or execute protected RPCs; authenticated users cannot directly insert into deposit/KYC/withdrawal tables; client task/withdrawal/profile helper RPCs remain available only to authenticated users.
- Read-only financial integrity audit confirmed zero unexplained balance for the two current profiles; the live financial tables are empty, so no state-transition E2E can truthfully be marked passed yet.
- Shop task completion is now consistent with the live UI: the browser completes each assigned task through the authenticated ownership-checked `complete_shop_task` RPC, each task debits its `task_value`, and the final task starts the 18-hour settlement. The separate `complete-cycle-checkout` endpoint remains hardened for exact full-cycle checkout.
- Controlled Master Admin session check resolved the actor as MASTER ADMIN with admin-scoped row visibility. The operational queues are currently empty, so live KYC/deposit/withdrawal end-to-end state transitions still require TESTNET_DEMO fixture records or real test submissions before they can be marked passed.

## Pending sequence

### Phase 1 — Production-safe application foundation
1. Operator-side: enable Supabase leaked-password protection when available on the current plan.
2. Complete TESTNET_DEMO end-to-end auth/KYC/deposit/withdrawal/referral/task transition tests.
3. Complete controlled Master Admin queue/review/account-operation transition tests.
4. Run a final Security Advisor review after all production configuration is settled.

### Phase 2 — Financial workflows
- Code and privilege review is complete for verified-deposit credit, Telegram withdrawal decisions, admin dashboard totals, and cycle settlement; the remaining task is live TESTNET_DEMO state-transition verification.
- Cycle settlement cron is active every minute and `settle_due_cycles()` is not executable by anon/authenticated roles.
- TESTNET_DEMO is still enforced with live deposits and real payouts disabled.
- Automatic `monitor-deposits` scheduling remains blocked until its server-side cron authentication secret is securely configured; no live monitoring was enabled during this session.

1. Validate deposit evidence submission and review.
2. Validate deposit verification/monitoring and ledger crediting in TESTNET_DEMO.
3. Validate withdrawal request -> dual approval -> payout recovery flow in TESTNET_DEMO.
4. Validate referral and exact Shop task-set settlement calculations.


### Phase 3 — Complete (controlled production-readiness layer)
- Added an explicit PRE_PRODUCTION configuration with a fail-closed payout lock.
- Added Master Admin-only get_production_readiness() diagnostics with no secret values exposed.
- Master Admin Settings shows production environment, network, live-deposit state, real-payout state, go-live approval and payout lock.
- Mainnet payout execution now enforces the Phase 3 production gate server-side; testnet payout behavior remains unchanged.
- Production go-live remains intentionally disabled until the required server-side secrets, monitoring, operator approval and final end-to-end smoke tests are completed.

### Post-Phase 3 go-live requirements
1. Replace TESTNET_DEMO configuration only after security gates pass.
2. Configure production TRON/USDT receiving address and payout secrets server-side.
3. Keep real payouts disabled until operator configuration and final smoke tests pass.
4. Enable live deposits/payouts only after explicit production go-live approval.

### Phase 4 — Complete
- Shop integration is wired through the dedicated Cloudflare `aegispay-shopping` Worker with task-aware return routing.
- Client assigned Shop tasks use the canonical product catalog, real-product gallery URLs with fallback imagery, ratings and review previews.
- Shop task purchase confirmation now returns to the canonical AegisPay client with task/product context.
- Client records the purchase confirmation through the authenticated `record_shop_task_purchase` RPC before `complete_shop_task` can proceed.
- Server-side task completion enforces task ownership, assigned-product matching, available-balance checks and the final 18-hour settlement transition. Latest hardening additionally enforces active account status, temporary security freeze and global runtime pause at the mutation boundary.
- Cart, product details, task ticket and checkout/return behavior are aligned for the intended AegisPay Shop workflow.

### Phase 5 — Source configuration complete; fresh artifact pending
- Canonical Android client and Master Admin flavors remain aligned to the root AegisPay portal sources and shared runtime assets.
- WebView authentication callbacks, file selection, QR scanning/location bridges and SHA-256 verified APK update flow are in the canonical Android runtime.
- Android CI is configured to build and verify both APK and AAB outputs for client and Master Admin, using signed release builds when release secrets are present and debug builds otherwise; current GitHub runner failures prevent verification of a fresh artifact.
- Android source/release workflow targets canonical Client flavor `versionCode 39 / versionName 2.6.0` and is configured to publish both APK and AAB. Build 39 has not yet been generated or hash-verified.
- Physical device installation/update verification remains part of the final Phase 6 QA gate and is not being falsely marked complete here.

### Phase 6 — Final production QA
1. Mobile and desktop regression testing.
2. Auth/session/logout/reset testing.
3. Admin authorization testing.
4. Financial edge-case testing.
5. Performance/security advisor re-check.
6. Final deployment and release checklist.
