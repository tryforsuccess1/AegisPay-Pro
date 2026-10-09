# AegisPay Operational Logic Audit — 2026-10-07

## Audit scope

The canonical GitHub repository, Supabase production project, Cloudflare Workers, Android packaging and deployment workflows were inventoried and the logic-bearing source was reviewed against the intended production sequence. The GitHub repository currently contains 96 tracked files in the main tree, with the main operational paths spanning the client UI, shared Supabase service layer, Master Admin, database migrations/RPCs, Edge Functions, Android shell, and CI/deployment workflows.

## Canonical production path

- Production client UI: `https://aegispay-web.aegispay.workers.dev/`
- Supabase project: `wtcspnrmsoisroavojop`
- Canonical GitHub source: `client.html` plus the Supabase functions/migrations and Android project.
- Legacy Netlify production pages are no longer referenced by the active client source or the active Cloudflare Worker.
- Supabase Auth Site URL was changed to the Cloudflare Worker by the project owner.
- Supabase Redirect URLs contain the canonical Worker pattern.
- Reset Password email template uses `{{ .ConfirmationURL }}`.

## Corrected operational flows

### Sign-up / email verification

1. Client submits email, username, password, name and optional referral code.
2. `public-signup` is called without JWT because this is a pre-auth operation.
3. The signup function uses public Auth signup, so Confirm Email remains authoritative.
4. Post-confirmation redirect is hard-locked in the function to the canonical Worker.
5. The Auth-created profile trigger now reads validated username metadata and creates the public profile without violating the username NOT NULL constraint.
6. Referral attribution occurs only through the server-side signup flow.

### Login

1. Client accepts either email or username.
2. Username/password is submitted to the `username-login` Edge Function; the function resolves the profile internally and validates the password with Supabase Auth.
3. The function returns session tokens only after successful credentials and only for an active, unfrozen client profile. A direct username-to-email RPC is not exposed to client roles.
4. Confirmed-email and account-role gates remain enforced by the existing session/profile claim flow.

### Forgot Password / account recovery

1. Client validates the email format and requests a reset email.
2. The reset redirect is hard-coded to the canonical Worker.
3. Supabase can return a PKCE `?code=` recovery callback; the Worker/client exchanges it with `exchangeCodeForSession()`.
4. Legacy implicit recovery tokens are also accepted through `setSession()`.
5. The client verifies that a recovery session exists before showing the password form.
6. The new password is sent to the protected `complete-password-reset` Edge Function.
7. The server validates the recovery session, role and account status.
8. The server records `password_reset_at` and applies a 24-hour `frozen_until` security freeze before changing the password.
9. The password is changed with server-only `auth.admin.updateUserById()`.
10. A password-reset audit event is recorded.
11. The client logs out and returns the user to the normal login screen.

### Deposit

1. Client selects an available tier and submits TXID + proof.
2. Server verifies identity, runtime status, account status, tier amount and evidence path.
3. AI review is only a precheck; no balance credit occurs from the screenshot alone.
4. Chain verification checks the confirmed TRON transfer, recipient, token contract and exact amount.
5. Only then does `apply_verified_deposit` credit the account.
6. A verified deposit starts the configured Shop cycle trigger.

### Shop task cycle

1. An eligible positive available balance causes `ensure_auto_task_cycle()` to create one active cycle when no active/waiting cycle exists.
2. Active Shop offers are mapped into the cycle as individual tasks.
3. The client now loads the active cycle and exact assigned task set.
4. Checkout is exposed only when the complete task set is present and the task values equal the cycle base.
5. Browser completion goes through `complete-cycle-checkout`; the current single-task browser RPC remains intentionally executable only to authenticated clients with ownership checks; the separate full-cycle checkout path is independently service-role protected.
6. The server rechecks ownership, exact task IDs, duplicate IDs, total task value, active cycle state and runtime.
7. All tasks move to Completed atomically enough to roll back task state if the cycle transition fails.
8. The cycle moves to `WAITING_18H` and the settlement timestamp is set.
9. Normal eligible future cycles are then created automatically.

### Withdrawal

1. Client submits an amount only through `request_withdrawal()`.
2. Server checks runtime, active account, minimum amount, wallet link, KYC verification and available balance.
3. Pending/held amounts are included so the same balance cannot be spent twice.
4. Master Admin review and Telegram approval remain separate decisions.
5. Payout requires both approvals plus the correct TESTNET/MAINNET runtime configuration.
6. Payout is atomically claimed as PROCESSING before broadcast and remains in PROCESSING if a broadcast outcome is uncertain, preventing duplicate payouts.
7. Payout completion is recorded with the TRON transaction ID.

### Password-reset security freeze

A reset now freezes sensitive operations for 24 hours. The freeze is enforced server-side on:
- new deposit submissions
- withdrawal requests
- withdrawal wallet linking
- automatic Shop cycle creation
- verified-deposit cycle creation
- Shop task-set checkout

The freeze intentionally does not prevent authentication, account viewing, KYC support/review, or settlement already in progress.

## Major bugs found and fixed during this audit

1. Reset flow detected only the implicit recovery hash and could fall through to Login when Supabase returned a PKCE code.
2. Password reset lacked a working form submission path in the first implementation.
3. Password reset email validation contained an escaping bug.
4. Old Netlify redirect destinations survived in Supabase Auth's default Site URL until corrected.
5. Signup code was allowed to accept a caller-selected redirect; server-side signup now hard-locks production redirect.
6. Public profile signup previously failed because the username column was NOT NULL while the Auth trigger did not populate it.
7. Client withdrawal-wallet linking called a legacy one-argument RPC that is now service-role-only; the client now uses the owner-name protected authenticated overload.
8. Client Shop tasks were display-only even though the backend had already retired the browser-callable single-task completion RPC. The client is now connected to the exact task-set checkout endpoint.
9. Password-reset security freeze existed as data fields/business intent but was not enforced across financial/cycle entry points. Enforcement is now in DB/RPC/Edge Function layers.

## Security checks

- Important public tables retain RLS.
- Private KYC/deposit evidence uses user-scoped storage paths/policies.
- Master Admin Edge Functions validate the authenticated actor and Master Admin role.
- Payout code is restricted to the configured TESTNET_DEMO/MAINNET runtime gates and never receives a private key from browser code.
- Service-role functions are called from server-side functions rather than exposing service keys to the client.
- Legacy single-task `complete_task(uuid)` is service-role-only.
- Legacy one-argument withdrawal-wallet RPC is service-role-only.
- The canonical Worker currently contains no Netlify URL.

## Current Supabase advisories

The security advisor still reports:
- intentional SECURITY DEFINER functions exposed to authenticated/anon callers, including username resolution and authenticated RPCs. These are protected by their own role/authentication checks and several are intentionally required by the client workflow.
- Leaked Password Protection is disabled. This is a Supabase Auth dashboard security setting and should be enabled for stronger password hygiene; the current connector does not expose the Auth service-config write API needed to toggle it.

Performance advisor notices are unused-index candidates, not correctness failures; they are not removed automatically because the system is currently in a low-traffic/demo state and removing them without workload evidence would be premature.

## Deployment verification

Cloudflare Worker `aegispay-web` currently has a 100% deployment on version `4df6eb5c-f85a-4000-8e74-e0c1d767de16` (deployment `e46b6ec8-4316-4b5b-8507-34669a988905`). The deployed Worker source was checked for password recovery, PKCE handling, exact Shop checkout, protected wallet linking, production verification redirect, and absence of Netlify references.

GitHub Actions currently shows CI/Web/Android/APK jobs failing immediately with zero runner time and no executed steps. This is consistent with a pre-run GitHub Actions infrastructure/runner problem rather than a source-code step failure; the runs were retried once and the same zero-step failure pattern occurred. Cloudflare production deployment was therefore verified directly rather than relying on the broken GitHub runner path.

## Final physical test

Open:

`https://aegispay-web.aegispay.workers.dev/?v=20261007-system-audit-final`

For password recovery, use a fresh reset email generated from this canonical Worker. Do not reuse any old reset email, because old single-use links can retain the destination that existed when they were generated.

Expected sequence:

Forgot Password → Gmail reset email → Reset Password link → AegisPay production page → Create a new password → Update Password → success → Login → sign in with the new password.

A successful password reset deliberately activates the 24-hour security freeze described above.
