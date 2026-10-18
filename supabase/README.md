# Supabase production layer

Project: `wtcspnrmsoisroavojop`

Audited on 2026-10-19: ACTIVE_HEALTHY, region `ap-northeast-1`; current runtime and grant checks are summarized in `docs/PRODUCTION_READINESS.md`.

## Live application surface

RLS-enabled public application tables:
`users`, `tasks`, `referrals`, `withdrawal_requests`, `activity_logs`, `notifications`, `platform_settings`, `vip_tiers`, `deposit_submissions`, `cycle_runs`, `account_ledger`, `admin_adjustments`, `shop_offers`, `audit_events`, `kyc_verifications`, `user_access_events`, `ai_support_cases`.

Active Edge Functions align with the repository function directories: `public-signup`, `username-login`, `submit-deposit`, `submit-kyc`, `admin-queues`, `admin-review`, `ai-support`, `verify-deposit`, `monitor-deposits`, `telegram-withdrawal`, `execute-payout`, `admin-account-ops`, `complete-cycle-checkout`, `complete-password-reset`, `production-readiness`, `withdrawal-ai-review`, `record-user-access`, `get-deposit-address`, and `sweep-deposit-wallets`.

## Storage

Bucket `private-verification` is live and private, limited to 10 MB and JPEG/PNG/WebP.

Storage policies are owner-scoped and guarded by `app_runtime_enabled()`:
- authenticated users can upload only under their own `auth.uid()` folder;
- users can read only their own evidence;
- `MASTER ADMIN` can read evidence for review;
- users can delete only their own evidence.

The canonical repository tracks this policy in `database/migrations/20261003_private_verification_storage_policies.sql`.

## Runtime boundary

Current `platform_settings.system_mode` is `MAINNET`, but all three production enablement flags (`live_deposits`, `real_payouts`, and `production_go_live_approved`) are `false`. `production_config.environment` is `PRE_PRODUCTION`, `live_deposits_enabled=false`, `real_payouts_enabled=false`, `go_live_approved=false`, and `payouts_locked=true`. Treat the system as closed to new funds. The HD deposit-address endpoint is fail-closed, and the live `deposit_wallets` and `deposit_submissions` tables currently contain zero rows.

Two active pg_cron jobs run every minute: `aegispay-cycle-settlement` settles due cycles and `aegispay-mainnet-deposit-monitor` invokes `monitor-deposits`. The cron secret is stored in Supabase Vault and the monitor's current deployed code verifies it via the restricted `verify_deposit_monitor_cron_secret` RPC when the Edge Function environment secret is absent or does not match. The latest recorded settlement and deposit-monitor cron runs checked during the 2026-10-19 audit (2026-10-18 23:24 UTC) succeeded. `deposit_wallets`, `deposit_submissions`, and both sweep-journal tables have zero rows, so real on-chain deposit reconciliation has not been exercised.

## Current review items

Security Advisor currently reports nine authenticated-callable SECURITY DEFINER RPCs for client-oriented flows plus three intentional RLS-enabled service-only deposit/sweep tables without client policies. Five reviewed legacy administrative RPCs are restricted from direct `anon`/`authenticated` execution; details and current verification limits are in `docs/PRODUCTION_READINESS.md`. These require function-by-function authorization review rather than blind revocation because some are intentionally used by the client workflow.

Leaked-password protection is currently reported as disabled and should be enabled before real production use.

Performance Advisor reports 20 unused-index notices and one unindexed foreign key (`ai_support_cases.resolved_by`). The unused indexes are review candidates, not automatic deletion targets. A forward-only index migration for the resolved-by foreign key is tracked in `database/migrations/20261012_ai_support_cases_resolved_by_index.sql`.

## Migration alignment

The live project contains historical migrations that predate the consolidated repository migration directory. They are already applied in production and must not be replayed. New database changes are tracked as forward-only migrations in `database/migrations/`.

## Secrets

Secret values are not exposed by the audit tools. Keep service-role, payout, Telegram and AI credentials server-side in Supabase configuration only.
