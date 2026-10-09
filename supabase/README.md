# Supabase production layer

Project: `wtcspnrmsoisroavojop`

Verified on 2026-10-03: ACTIVE/HEALTHY, region `ap-northeast-1`.

## Live application surface

RLS-enabled public application tables:
`users`, `tasks`, `referrals`, `withdrawal_requests`, `activity_logs`, `notifications`, `platform_settings`, `vip_tiers`, `deposit_submissions`, `cycle_runs`, `account_ledger`, `admin_adjustments`, `shop_offers`, `audit_events`, `kyc_verifications`.

Active Edge Functions align with the repository function directories: `public-signup`, `username-login`, `submit-deposit`, `submit-kyc`, `admin-queues`, `admin-review`, `ai-support`, `verify-deposit`, `monitor-deposits`, `telegram-withdrawal`, `execute-payout`, `admin-account-ops`, `complete-cycle-checkout`, `complete-password-reset`, `production-readiness`.

## Storage

Bucket `private-verification` is live and private, limited to 10 MB and JPEG/PNG/WebP.

Storage policies are owner-scoped and guarded by `app_runtime_enabled()`:
- authenticated users can upload only under their own `auth.uid()` folder;
- users can read only their own evidence;
- `MASTER ADMIN` can read evidence for review;
- users can delete only their own evidence.

The canonical repository tracks this policy in `database/migrations/20261003_private_verification_storage_policies.sql`.

## Runtime boundary

Current `platform_settings.system_mode` is `MAINNET / LIVE_DEPOSIT_TEST` with controlled live-deposit testing enabled and real payouts disabled behind the Phase 3 production gate.

One active pg_cron job, `aegispay-cycle-settlement`, runs every minute.

## Current review items

Security Advisor reports authenticated execution of several SECURITY DEFINER RPCs. These require function-by-function authorization review rather than blind revocation because some are intentionally used by the client workflow.

Leaked-password protection is currently reported as disabled and should be enabled before real production use.

Performance Advisor reports several unused indexes. With the present small dataset, these are review candidates rather than automatic deletion targets.

## Migration alignment

The live project contains historical migrations that predate the consolidated repository migration directory. They are already applied in production and must not be replayed. New database changes are tracked as forward-only migrations in `database/migrations/`.

## Secrets

Secret values are not exposed by the audit tools. Keep service-role, payout, Telegram and AI credentials server-side in Supabase configuration only.
