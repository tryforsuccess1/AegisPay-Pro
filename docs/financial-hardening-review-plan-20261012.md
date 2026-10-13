# AegisPay financial hardening — isolated implementation and release plan

**Status:** Review plan only; not an implementation.  
**Production policy:** No production migrations, balance/ledger changes, or payout-setting changes are permitted under this plan. Real payouts must remain disabled and locked.

## Current verified blockers

1. `public.apply_verified_deposit(uuid,text,text,timestamptz,text)` currently gates TRON MAINNET credit on `system_mode.real_payouts = true`, while the current runtime config has live deposits enabled and real payouts disabled. That couples deposit permission to payout permission incorrectly.
2. The legacy `record_withdrawal_telegram_decision` path can change withdrawal/balance state without consistently creating matching ledger entries. PR #7 improves `finalize_withdrawal`, but is not complete while the alternate path remains.
3. No Supabase development branch currently exists for the connected project. No financial transition tests have been run in an isolated database. The existing CI/build checks are not database transaction tests.

## A. Deposit credit migration — requirements before implementation

Create a new forward-only migration on a feature branch. Do not apply it to production.

- Separate **deposit enablement** from **payout enablement**. MAINNET deposit credit must require the intended deposit gates (network is MAINNET/TRON MAINNET, live deposits enabled in the canonical settings, configured TRC20 contract and receiving address, AegisPay runtime enabled, and trusted server-side proof of a confirmed transfer); it must not require real payouts to be enabled.
- The database function must fail closed unless the deposit row is pending verification and its evidence has an approved review state. The trusted verifier must confirm chain, receiving address, token contract, transaction hash, recipient, exact token amount/decimals, confirmation/finality, and transaction time before calling the credit RPC.
- Keep the row lock and status transition in one transaction. A repeated call for an already verified deposit must return without changing balances or generating additional ledger/referral/cycle effects.
- Add/confirm a database-enforced unique idempotency constraint for the verified deposit reference in the financial ledger, and a unique transaction/network identity for submissions where compatible with existing data. Preflight for existing conflicts; fail the migration rather than deleting or rewriting existing financial history.
- Restrict the credit RPC to the trusted server role only. Revoke execute from PUBLIC/anon/authenticated, and use a fixed safe search path with schema-qualified object names in the SECURITY DEFINER body.
- Preserve the existing token contract and fee behavior; do not alter production settings or credit any existing production rows.

## B. Withdrawal accounting — canonical state machine

Complete PR #7 only after the existing alternate Telegram path is handled. Use one canonical transactional transition function for every withdrawal state change; the Telegram Edge Function must invoke that function or the legacy path must be retired and its execute privileges revoked.

Canonical accounting invariants:
- At request time, lock the user's row and enforce `available = current_platform_balance - withdrawal_held >= requested_amount`; validate positive finite amount, active/unfrozen account, valid exact-case TRON address, runtime state, and request limits.
- Reserve funds atomically by incrementing `withdrawal_held` and creating one ledger hold entry keyed to the withdrawal ID. Do not also debit the spendable balance at request time unless the implementation explicitly chooses a debit-at-request model and proves the hold is not double-counted. Use one accounting model consistently.
- Approval atomically converts the reservation into the final debit and writes exactly one `WITHDRAWAL_DEBIT` row. Use row locks and a unique ledger reference/idempotency constraint; reject conflicting pre-existing references rather than silently ignoring them.
- Rejection or a provably pre-broadcast failure atomically releases the hold or reverses the debit according to the chosen model and adds the corresponding ledger release/refund exactly once.
- If payout broadcasting may have started or its result is uncertain, do not automatically refund; leave the request pending reconciliation until chain state is verified.
- Never clamp mismatched balances/holds with `GREATEST(0, ...)`. Validate state and sufficient amounts, and raise an exception so all statements roll back together.
- Historical repair must be narrowly preflighted and fail closed on ambiguous, missing, conflicting, or duplicate records. Do not make live balance adjustments as part of this PR.
- Review grants and all clients/Edge Functions calling `finalize_withdrawal`, `record_withdrawal_telegram_decision`, payout execution, and recovery RPCs before removing or redirecting any path.

## C. Isolated database test matrix

Execute these against a new Supabase development branch only, using synthetic fixture users, deposits, ledger rows, and withdrawals. Tests must roll back fixtures or clean up only synthetic IDs. Capture raw test output in the PR.

| Area | Test | Required result |
|---|---|---|
| Deposit | Confirmed, approved deposit on MAINNET while real payouts remain disabled | Exactly one credit and one deposit ledger row; deposit gate does not depend on payout permission |
| Deposit | Call credit RPC twice for the same deposit | Second call is a no-op; balances, ledger, referral and cycle side effects unchanged |
| Deposit | Pending review, rejected evidence, wrong contract, wrong recipient, wrong amount, unconfirmed transfer | No credit; no verified ledger entry |
| Deposit | Two concurrent verifier calls for the same deposit | One effective credit only |
| Withdrawal | Request within available balance | One reservation/hold and one ledger hold row |
| Withdrawal | Request above available balance | Rejected; balance and hold unchanged |
| Withdrawal | Two concurrent withdrawals competing for same available balance | Only amounts within available balance are reserved; balance never negative |
| Withdrawal | Reject pending request | Hold released exactly once; matching ledger release; second reject is no-op/error without extra mutation |
| Withdrawal | Definite failure before broadcast | Reservation/debit reversed once with an auditable ledger record |
| Withdrawal | Broadcast timeout / TXID uncertain | No auto-refund; request remains in reconciliation state |
| Telegram path | Approve/reject/retry via Telegram | Same canonical transition and ledger invariants as the admin workflow |
| Atomicity | Force an exception after balance/hold mutation but before ledger insert | Entire transaction rolls back |
| Regression | Referral and Shop/cycle side effects during first verified deposit | At most one set of side effects under retries/concurrency |
| Integrity | Inspect all fixture user balances and holds after each case | No negative balance/hold; ledger ties to each transition |

Add assertions for exact ledger reference IDs, expected row counts, balance before/after, idempotent retries, and no partial writes. A passing static CI/build is not a substitute for these database tests.

## Isolated execution steps

1. Create/confirm a Supabase development branch from the current project schema. Confirm the branch project reference is not the production reference before running any migration.
2. Apply the feature-branch migrations only to that branch.
3. Run SQL syntax checks and the financial transition test suite using synthetic fixtures; save output and test counts in the corresponding PR.
4. Re-run Supabase Security Advisor on the development branch and inspect grants/RLS. Review all code paths and compare live Edge Function sources to the feature branch.
5. Open separate PRs for deposit-credit, withdrawal-ledger, and isolated financial tests. Do not merge to `main` until each PR has reviewed diffs and reproducible passing output.

## Production migration plan — review-ready, not applied

Production must remain untouched until all three feature PRs pass and are reviewed. Before a later production release:

1. Take a verified database backup and export the migration history. Record the currently deployed commit and Edge Function versions.
2. Reconcile all existing pending/verified deposits and all withdrawal request, hold, debit, refund, TXID, and audit-event records. Produce a signed-off report of exceptions; do not auto-correct ambiguous records.
3. Review migration SQL for exact function signatures, grants/revokes, constraints, lock order, rollback behavior, statement termination, and compatibility with existing rows.
4. Apply approved migrations to a staging branch and repeat the complete test matrix against that exact commit.
5. Conduct a separately approved production change window. Apply forward-only migrations in dependency order only after backup verification and explicit release approval. Do not enable real payouts as part of this database migration.
6. Verify migration history, payout lock, zero unexpected balance/ledger differences, and security advisor output. Keep payout lock enabled until a separate go-live review.
7. Define a tested rollback/forward-repair plan for schema/code deployment. Do not use a blind balance rollback once financial activity may have occurred.

**No production commands were run or authorized by this document.**

## Current execution state — 2026-10-13

- The connected Supabase organization `ali.shahid9181` is on the **Free** plan.
- Supabase rejected development-branch creation with: `Branching is supported only on the Pro plan or above`.
- A branch price of **$0.01344 per hour** was quoted, but the branch was **not created**. No branch-hourly resource was started.
- The project owner explicitly instructed us not to create the development branch yet and to stop before incurring branch cost. **Do not retry branch creation, upgrade the plan, create another paid development resource, or apply financial migrations unless the owner explicitly reauthorizes that path.**
- Therefore the isolated database test matrix is still **BLOCKED / NOT RUN**. Static CI and Android build checks do not prove deposit-credit or withdrawal-ledger correctness.
- No production migration, balance change, ledger repair, payout-setting change, or payout unlock is permitted. Real payouts remain disabled/locked.
- Safe work may continue as read-only source review, static analysis, and review-plan documentation on GitHub feature branches. Any financial implementation must wait for a permitted, explicitly authorized test environment and a reviewed code-change path.
