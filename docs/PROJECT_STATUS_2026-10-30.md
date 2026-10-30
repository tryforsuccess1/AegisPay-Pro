# AegisPay Project Security and Testnet Audit

**Audit date:** 2026-10-30  
**Canonical repository:** `tryforsuccess1/AegisPay-Pro`  
**Audited main commit:** `8951c716d416fb17e8342aff52f3e95297e437fd`  
**Supabase project:** `wtcspnrmsoisroavojop`  
**Cloudflare Pages project:** `aegispay-pro`

This report records read-only verification and the owner's decision to defer Supabase's native leaked-password protection while remaining on the Free plan. It does not approve or enable Mainnet money movement.

## 1. Owner decision: leaked-password protection deferred

- The owner confirmed the organization will remain on Supabase Free and asked to remove native Leaked Password Protection from the active task list for now.
- This is an **accepted/deferred plan limitation**, not a technical removal or a claim that the Security Advisor warning disappeared. Supabase still reports `auth_leaked_password_protection` as disabled.
- The repository's controlled signup and password-reset Edge Functions call the custom `assertPasswordNotPwned` check and apply the centralized password policy. This is useful additional protection for those flows, but it is not equivalent to Supabase's native protection for every possible password-change path.
- Cloudflare Turnstile is implemented in the client and the public site key in `aegis-turnstile.js` matches the account's `AegisPay Authentication` widget. The widget is in Managed mode and allows:
  - `aegispay-pro.pages.dev`
  - `aegispay-web.aegispay.workers.dev`
  - `appassets.androidplatform.net`
  - `shasta-test-ui.aegispay-pro.pages.dev`
- Supabase Auth logs contain 36 rejected password-grant requests with `captcha_failed` (HTTP 400) during 2026-10-29 15:38–18:50 UTC. The recorded causes include missing or invalid CAPTCHA responses. This confirms that the Auth CAPTCHA gate is rejecting requests without acceptable tokens; it does **not** constitute a successful human sign-in test or prove that every client flow is working.
- Secret values are not exposed or recorded in this report. A successful interactive login on a real browser and an Android device remains a QA check.

**Tracking decision:** Do not block the current Free-plan work on the native leaked-password warning. Keep it listed as an accepted risk/deferred enhancement, not as a completed technical control.

## 2. Source, CI and deployment verification

- Main is at commit `8951c716d416fb17e8342aff52f3e95297e437fd`.
- GitHub Actions runs for AegisPay CI, Web Portal Deploy, Android APKs and Client/Master Admin APK Release completed successfully for that commit.
- Cloudflare Pages production deployment `be55fa97-a345-4b6b-9074-9c4ba9572702` is successful and references the same Main commit.
- Cloudflare Worker `aegispay-web` has a latest deployment with 100% traffic assigned to its active version. The corresponding deployment was created at approximately the same time as the production Pages deployment.
- The Turnstile widget allowlist covers the canonical Pages hostname, Worker hostname, Android WebView asset hostname and the Shasta test UI hostname.

## 3. Database and Mainnet safety

Read-only SQL checks on 2026-10-30 returned:

| Control | Current value |
|---|---|
| `production_config.environment` | `PRE_PRODUCTION` |
| `live_deposits_enabled` | `false` |
| `real_payouts_enabled` | `false` |
| `go_live_approved` | `false` |
| `payouts_locked` | `true` |
| `system_mode.mode` | `MAINNET` |
| `system_mode.live_deposits` | `false` |
| `system_mode.real_payouts` | `false` |
| `system_mode.production_go_live_approved` | `false` |

- All 26 public tables have RLS enabled. The public schema has 34 RLS policies.
- Deposit-wallet, sweep-journal and payout-journal tables deny direct `anon` and `authenticated` client access.
- `execute-payout` performs its own Supabase Auth Bearer-token check and verifies the user's withdrawal ownership and approval state. Its Mainnet path additionally requires all production gates to be open.
- `sweep-mainnet-deposit-wallets` is deployed fail-closed: it requires the independent `AEGIS_ENABLE_MAINNET_SWEEP=true` switch, the dedicated cron secret and all production gates to be open. It was not invoked during this audit.
- The active `aegispay-mainnet-deposit-monitor` database cron job runs once per minute. Its SQL wrapper checks the Mainnet mode, network, exact token contract, live-deposit/payout/go-live flags and production environment before calling `monitor-deposits`. Current gate values make its condition false, so it does not dispatch the Edge Function.
- The only database cron jobs found were cycle settlement and the gated Mainnet deposit monitor. No Mainnet sweeper cron schedule was found.
- The Edge Functions and cron jobs were not invoked for any payout, sweep or other blockchain transfer during this audit.

**Keep all Mainnet gates closed.** Do not enable live deposits, real payouts, go-live approval or the Mainnet sweep feature flag without a separate approved production-readiness process.

## 4. Shasta testnet financial reconciliation

Read-only database records show:

### Deposits and ledger

- Seven Shasta testnet deposit submissions are marked `VERIFIED`.
- Their credited total is 830.00 USDT.
- Each of the seven submissions has exactly one matching `USER_DEPOSIT` ledger row keyed by deposit-submission ID.
- The sum of those ledger credits is 830.00; there are no missing or duplicate `USER_DEPOSIT` rows in this set.
- All seven rows have 64-character transaction IDs, the expected Shasta test token contract and a credited amount matching the submission amount.

### Sweep journal

- Two Shasta sweep-journal records are `CONFIRMED`, with transaction IDs, saved signed payloads and no recorded failure code.
- Their combined raw token amount is 230,000,000 (230.00 USDT at six token decimals).
- Five verified deposit submissions are linked to the two confirmed sweep batches.
- Two later verified deposits (100.00 and 500.00 USDT) have no sweep-item mapping and no recorded sweep attempt. Their combined 600.00 USDT is **not recorded as swept** in the journal.
- The database status is not an independent fresh chain lookup. Confirm chain balances and transaction receipts before any additional testnet sweep. Do not run the worker just to clear these rows.

### Withdrawals

- Six Shasta payout-journal records are marked `PAID`, each with a payout transaction ID and `FIXED_WALLET` mode. No `EPHEMERAL_HD` entries appear in these six journal rows.
- Six of the seven `PAID` withdrawal requests match a payout-journal record and a corresponding debit ledger row.
- One older 60.00 USDT `PAID` request has a payout transaction ID and debit ledger row but has no row in the newer payout journal. Treat it as a legacy payout requiring independent transaction reconciliation; do not fabricate a journal entry or change its financial status without chain evidence.
- One 100.00 USDT `FAILED` request records cancellation before broadcast because the stored TRON destination failed Base58Check. It has no payout transaction ID, no payout-start timestamp, `balance_deducted=false`, and its debit/refund ledger entries net to 0.00.

The records above are database-side reconciliation evidence. This audit did not independently query each Shasta transaction from a public explorer, and it did not create or broadcast any transaction.

## 5. Remaining work, ordered

1. **Testnet chain reconciliation:** verify the two unswept Shasta deposit wallets' current balances and source transfers using a read-only explorer/API check. Then decide whether a test-only sweep is appropriate; do not infer that the 600 USDT is still on those wallets solely from the database mapping.
2. **Legacy payout reconciliation:** independently verify the older 60.00 USDT payout transaction and document its chain receipt. Only then decide whether a historical journal backfill is required and safe.
3. **Interactive authentication QA:** complete a human login/signup/recovery smoke test on the canonical Pages portal and a physical Android client. The CAPTCHA rejection logs confirm the gate is active, but the audit window did not establish a successful human CAPTCHA flow.
4. **Testnet end-to-end QA:** complete any remaining deposit-monitor/recovery, transaction-expiry, fee/resource and withdrawal reconciliation tests using Shasta resources only.
5. **Final security review:** rerun Supabase Security Advisor after operational QA. Keep the native leaked-password finding as an explicitly accepted Free-plan exception unless the owner changes the plan decision.

## 6. Actions deliberately not performed

- No Supabase plan upgrade or paid billing change.
- No secret, mnemonic, private key or treasury value read, changed or exposed.
- No Mainnet gate opened.
- No Mainnet or Shasta sweep/payout function invoked by this audit.
- No on-chain transaction created, signed or broadcast.
- No historical financial status, ledger balance or payout journal was modified.
