# AegisPay Web Portal Architecture

## Purpose

This document is the source-of-truth map for the public website, Client Portal, Master Admin Portal, Supabase integration and Cloudflare Pages deployment.

## Web surfaces

### Public Website

- Production route: `/`
- Source: `site/index.html`
- Styling: `site/site.css`
- Purpose: product introduction, test/demo disclosure and Client APK distribution.
- The public site must not expose Master Admin APK links or privileged credentials.

### Client Portal

- Production route: `/app/`
- Source of truth: root `client.html`
- Build destination: `site/app/index.html`
- The client source is self-contained; only required helper assets are copied into `site/app/` during deployment.
- Client browser business/auth/runtime: root `client.html` (self-contained).
- Client portal uses Supabase-backed account, deposit, KYC, Shop/task, referral, notification and withdrawal workflows.

### Master Admin Portal

- Production route: `/admin/`
- Cloudflare Pages redirect target: `/master-admin.html`
- Source of truth: root `master-admin.html` and `admin-auth.js` plus shared Supabase/auth helpers
- Build destination: `site/master-admin.html` and `site/admin-auth.js`
- Master Admin access is determined by the protected AegisPay profile role, not by client-side labels.

## Cloudflare Pages routing

`site/_redirects` is the routing source:

- `/app/` -> `/app/index.html`
- `/app/auth/callback` -> `/app/index.html`
- `/auth/callback` -> `/app/index.html`
- `/client`, `/client/`, `/client.html` -> `/app/`
- `/admin`, `/admin/` -> `/master-admin.html`

The web deployment workflow copies canonical root portal files into their publish destinations on every build so duplicate source files cannot silently drift.

## Authentication flow

### Client test-mode signup

1. Client submits name, email, password and optional referral code.
2. Browser calls Supabase Edge Function `public-signup`.
3. The function only permits the controlled `TESTNET_DEMO / TEST_MODE` mode.
4. Referral codes are validated server-side.
5. Supabase Auth creates the user with email confirmation enabled for test mode.
6. The Auth database trigger links/creates the AegisPay profile.
7. The function confirms that an AegisPay profile exists for the new Auth user before reporting success.
8. Browser signs in and calls `claim_aegispay_profile`.
9. The client dashboard loads Supabase-backed business data.

### Production signup

Production should use normal Supabase email-confirmation behavior with a verified SMTP sender/domain. Test-mode auto-confirmation must not be treated as the production email-verification design.

### Error handling

Client-side Edge Function errors are parsed through the `FunctionsHttpError` response body instead of displaying only the generic "non-2xx" message. Server-side signup errors are logged with a request ID and returned using appropriate HTTP status classes.

## Supabase data layer

Client-readable application data is protected by RLS. Client-owned reads are scoped through `current_app_user_id()`; Master Admin reads use the protected role check.

Key tables:

- `users`
- `deposit_submissions`
- `cycle_runs`
- `tasks`
- `shop_offers`
- `vip_tiers`
- `referrals`
- `notifications`
- `withdrawal_requests`
- `kyc_verifications`
- `platform_settings`

Sensitive balance mutations, task completion, wallet linking and withdrawal requests use protected database functions or Edge Functions.

## Supabase Edge Functions

- `public-signup`: controlled client test signup.
- `username-login`: pre-auth username/password authentication; performs the credential check server-side and returns a session only after successful password verification. Requests are rate-limited; it does not return the registered email address.
- `submit-deposit`: stores deposit evidence and runs deposit evidence review.
- `verify-deposit`: verifies a submitted deposit against confirmed TRON transfers.
- `monitor-deposits`: server-side automated deposit monitoring.
- `submit-kyc`: stores KYC evidence and runs KYC review.
- `ai-support`: informational client support only.
- `admin-queues`: Master Admin queue data.
- `admin-review`: Master Admin review actions.
- `telegram-withdrawal`: internal withdrawal approval communication.
- `execute-payout`: guarded payout path; testnet/mainnet behavior depends on server-side mode and secrets.
- `complete-cycle-checkout`: separately hardened server-side exact assigned-task-set checkout endpoint. The current client UI completes assigned tasks individually through the authenticated `complete_shop_task` RPC; the final task moves the cycle to `WAITING_18H`. The legacy one-argument withdrawal-wallet RPC remains retired.

Service-role keys, payout keys, Telegram credentials and other secrets must remain server-side.

## Storage

The private bucket `private-verification` stores deposit/KYC evidence.

- Public access: disabled.
- Allowed images: JPEG, PNG, WebP.
- Maximum file size: 10 MB.
- Upload paths are scoped by Auth user ID.
- Client read access is owner-scoped; Master Admin can review evidence.

## Controlled pre-production network state

The current platform is intentionally held in a controlled PRE_PRODUCTION / LIVE_DEPOSIT_TEST state:

- System mode: MAINNET / LIVE_DEPOSIT_TEST
- Controlled live-deposit testing: enabled
- Real payouts: disabled
- Phase 3 production payout gate: locked
- Production go-live approval: not granted

Network-specific deposit/payout secrets and wallet details remain server-side and are not exposed in this architecture document.

## Automation

- `pg_cron` is enabled.
- `pg_net` is enabled.
- Cycle settlement cron is active.
- Deposit monitoring cron is intentionally not enabled until its server-side authentication secret is securely configured.
- Supabase Vault currently contains no configured secrets for this automation path.

## QA gate before publication

1. Public website opens and displays explicit test/demo status.
2. `/app/` loads without a white screen and all nested local assets resolve.
3. Client signup returns a readable result for valid and invalid inputs.
4. Confirmed Client Auth session maps to exactly one AegisPay profile.
5. Client reads only its own business data.
6. Master Admin can sign in and reach protected operations.
7. Master Admin actions stay behind role checks.
8. Deposit evidence upload reaches the private storage bucket.
9. Testnet deposit verification is tested with Shasta only.
10. Shop cycle/task assignment and completion are verified.
11. 18-hour settlement is verified by scheduled database execution.
12. Withdrawal approval remains dual-control and no real payout is enabled.
13. Production Auth SMTP/redirect configuration is verified.
14. Remaining security advisor findings are reviewed before public production use.

## Current non-production blockers

- A real production SMTP sender/domain must be configured and verified for production email confirmation.
- `monitor-deposits` needs a securely stored cron authentication secret before automatic chain monitoring is enabled.
- Security advisor warnings about exposed SECURITY DEFINER functions and leaked-password protection still require final production review.
- GitHub source and live Supabase migration history need to remain reconciled as changes continue.
