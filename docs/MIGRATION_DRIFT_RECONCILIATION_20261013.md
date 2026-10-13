# AegisPay Migration Drift Reconciliation — 13 October 2026

## Scope

This is a read-only reconciliation of canonical GitHub repository `tryforsuccess1/AegisPay-Pro` against the live Supabase project `wtcspnrmsoisroavojop`. The audit intentionally did not create a Supabase project/branch, apply SQL migrations, reset the database, alter migration history, or change financial records.

## Inventory result

| Check | Result |
|---|---:|
| Applied migration records in Supabase | 83 |
| SQL files in `database/migrations/` on `main` | 73 |
| File/ledger pairs matched by normalized migration names | 60 |
| Repository files without a normalized ledger match | 13 |
| Ledger records without a normalized repository file match | 23 |

The files in `database/migrations/` are a historical source collection, not a reliable one-to-one replay set for the live migration ledger. Many are date-prefixed snapshots while Supabase records include apply-time versions and sometimes different names. A name mismatch alone does **not** prove that a schema change is absent from the live database.

## Live read-only checks

The following checks passed at the time of audit:

- All 17 application tables in the `public` schema have Row Level Security enabled.
- The live public schema contains 207 columns and 44 routines; no disabled application triggers or unvalidated constraints were found.
- Both AegisPay cron jobs are active: cycle settlement and Mainnet deposit monitoring.
- Shop data consistency checks reported zero missing task-to-cycle links, zero task/cycle owner mismatches, zero cycles without tasks, zero cycle/task-value mismatches, zero open cycles with all tasks already complete, and zero waiting cycles with incomplete tasks.
- The old node feature is absent (`public.active_nodes` and `tasks.related_node_id` do not exist).
- The tier-selection/automatic-cycle functions and balance-change trigger exist.
- The private verification bucket policies exist for owner-scoped upload/read/delete; the Master Admin read condition is present.
- The display-name column and AI display-name RPC exist.
- The four Shop purchase-confirmation columns and purchase RPC exist. Both per-task completion and cycle checkout check the purchase-confirmation flag, Shop task completion contains the purchase debit, and cycle checkout execution is restricted to `service_role`.
- The legacy three-argument withdrawal RPC and legacy task-completion RPC are not executable by `authenticated`.
- The live production settings remain fail-closed: `PRE_PRODUCTION`, live deposits disabled, real payouts disabled, go-live approval false, and payout lock enabled.

There are no deposit-submission rows, so a real deposit-monitoring/reconciliation path has not been exercised by this audit. These checks verify live schema and stored-data consistency, not every end-to-end user journey.

## Repository-only source files whose live effect was checked

These files did not map to a unique ledger record by normalized name. Their current effect was checked against the live schema/configuration:

| Repository file | Read-only finding | Replay decision |
|---|---|---|
| `20260928_remove_nodes.sql` | The node table and retired task column are already absent. The file contains `DROP TABLE ... CASCADE`. | **Do not replay.** |
| `20261001_harden_withdrawal_and_frozen_operations.sql` | The current one-argument withdrawal RPC has runtime/account-state checks; the older three-argument RPC is not executable by authenticated users. | Treat as historical/superseded; do not replay blindly. |
| `20261001_live_cycle_task_workflow.sql` | Cycle/task columns and the verified-deposit trigger are already present. Newer task/tier workflow functions are live. | Do not replay blindly. |
| `20261002_restore_test_signup_mode.sql` | This is a settings data migration that replaces `system_mode` with `TESTNET_DEMO`; current production configuration has intentionally moved on. | **Do not replay.** |
| `20261003_private_verification_storage_policies.sql` | The three expected owner-scoped verification storage policies are present. | Already represented by live effect; do not replay blindly. |
| `20261005_auto_assign_task_cycle_on_balance_change.sql` | The trigger and function are present. The file also includes a data-repair loop that can create cycles for eligible users. | **Do not replay; it can change live data.** |
| `20261008_ai_safe_self_service.sql` | The `display_name` column and RPC are present. | Effect is present; do not replay blindly. |
| `20261008_custom_deposit_amounts.sql` | Current `deposit_rules` already has fee 0 and no fixed minimum key. The file writes live settings. | Effect is present; do not replay blindly. |
| `20261008_restrict_shop_cycle_checkout.sql` | Current cycle-checkout RPC is executable by `service_role`, not `authenticated`. | Access effect is present; do not replay blindly. |
| `20261008_secure_shop_cycle_checkout.sql` | The current checkout function checks the runtime flag and purchase confirmation, and is service-role only. | Newer live definition is present; do not replay blindly. |
| `20261008_shop_task_balance_debit.sql` | The current task function checks purchase confirmation and records the Shop debit. | Newer live definition is present; do not replay blindly. |
| `20261008_tier_selection_and_per_task_completion.sql` | Tier selection, automatic-cycle creation, and the user-change trigger exist. | Effect is present; do not replay blindly. |
| `20261009_shop_purchase_confirmation_workflow.sql` | Four confirmation columns, purchase RPC, completion guards, and service-role checkout restriction are present. | Effect is present; do not replay blindly. |

## Remaining source-history gap

The live ledger still contains records for which the exact original SQL has not been recovered in the current canonical source set. The following early foundation migrations are the clearest examples:

- `aegispay_production_security_workflows`
- `claim_authenticated_aegispay_profile`
- `aegispay_operational_audit_triggers`
- `aegispay_final_business_model`
- `aegispay_mainnet_ops_foundation_v2`

Other unmatched ledger names include historical security/RLS changes, runtime-function security, signup-trigger repair, checkout hardening, AI approval policy, and Mainnet monitor scheduling. Several of these have relevant current effects, but the original SQL for every unmatched record has not yet been proven equivalent to a current repository file.

## Safe handling rule

1. Do not rerun date-prefixed repository files against production just because a name is missing from the ledger.
2. Do not delete/rewrite rows in `supabase_migrations.schema_migrations` to force the counts to match.
3. Do not run a production reset or replay the whole folder. In particular, never replay the node-drop, test-mode settings, or automatic-cycle data-repair migrations.
4. New database changes must remain forward-only. Their exact applied migration version and source file must be recorded together.
5. A reliable fresh-bootstrap test cannot be claimed until the missing historical source is recovered or a separately designed baseline is reconstructed and tested. This audit did not perform that destructive test.

## Status

**Live schema/data consistency: passed for the read-only checks listed above.**

**Migration source-history reconciliation: partially complete, not fully closed.** The live runtime effects checked above are present, but 23 historical ledger records do not yet have a verified one-to-one source mapping. No production data or migration metadata was changed during this audit.


## Follow-up: historical-source recovery and transactional tests

### Historical source snapshots recovered

The legacy repository contains several dated versions of `database/schema.sql`, which clarify the broad schema evolution:

- [Initial data model snapshot](https://github.com/msmgroups5/AegisPay-pro/blob/76919b41e3b416c61c599c5155748c7fed1f2469/database/schema.sql)
- [Supabase Auth/RLS-aligned schema snapshot](https://github.com/msmgroups5/AegisPay-pro/blob/e6dfcb9cff8ff3e2bf4660145e61f5ae4c96cd17/database/schema.sql)
- [Node-removal schema snapshot](https://github.com/msmgroups5/AegisPay-pro/blob/7d66ea7574f8315175cb77a85765de002b93df8e/database/schema.sql)
- [Consolidated client/admin schema snapshot](https://github.com/msmgroups5/AegisPay-pro/blob/7a0a017ff92fefb46cbe394a4f0f8897332125c7/database/schema.sql)
- [Later fresh-v1 schema snapshot](https://github.com/msmgroups5/AegisPay-pro/blob/aa62e59b3a1d988ca7b0d741e471dc5eaed6b771/database/schema.sql)

These are schema snapshots, not the original SQL bodies of the five earliest unmatched Supabase ledger records. The later snapshot explicitly drops/recreates `public.tasks` and removes retired-node structures. None of these snapshots is safe to replay against the live project. The initial ledger entries were applied before or outside the currently retained standalone SQL migration history; the original text of every such submission has not been recovered.

### Current-effect mapping for the 23 ledger records without a one-to-one filename match

| Applied ledger name | Current evidence | Reconciliation status |
|---|---|---|
| `aegispay_production_security_workflows` | Core application schema and RLS/security routines exist. | Broad historical baseline; exact submitted SQL unavailable. |
| `claim_authenticated_aegispay_profile` | `public.claim_aegispay_profile()` exists with an empty search path; one `auth.users` trigger invokes `handle_new_aegispay_auth_user()`. | Effect verified; exact original SQL unavailable. |
| `aegispay_operational_audit_triggers` | Audit triggers exist for referral creation, task completion, and withdrawal creation/finalization. | Effect verified; exact original SQL unavailable. |
| `aegispay_final_business_model` | Current model has 17 public application tables; retired node table/column are absent. | Current model verified; exact original SQL unavailable. |
| `aegispay_mainnet_ops_foundation_v2` | `pg_net` and `pg_cron` are present; the current production configuration is fail-closed. | Current effect verified; exact original SQL unavailable. |
| `harden_withdrawal_and_frozen_user_operations` | The legacy repository contains `20261001_harden_withdrawal_and_frozen_operations.sql`; current withdrawal code has been hardened further. | Historical ancestor found; do not replay. |
| `restore_runtime_function_security` | All 41 live public SECURITY DEFINER functions have an empty `search_path`; zero exceptions found. | Current security state verified; exact historical SQL unavailable. |
| `enable_pg_net_for_deposit_monitoring` | `pg_net` is installed and the current Mainnet monitor cron job is active. | Effect verified; exact original SQL unavailable. |
| `narrow_client_rls_policies` | All 17 public tables have RLS enabled; key client task reads are scoped to the user, with Master Admin access. | Key effects verified; exact original policy patch unavailable. |
| `fix_aegispay_signup_trigger_metadata_column` | One auth-user trigger is active; current trigger reads `raw_app_meta_data` for approved-invite state and `raw_user_meta_data` for name/username/language/referral fields. | Current trigger behavior verified; exact original SQL unavailable. |
| `private_verification_delete_policy_hardening` | The expected three owner-scoped verification storage policies exist. The repository has `20261003_private_verification_storage_policies.sql`. | Semantic source/effect match; do not replay blindly. |
| `auto_task_cycle_balance_trigger` | The user-change trigger exists and calls `ensure_auto_task_cycle`. | Effect/source lineage identified; do not replay because the source also contains a live-data repair loop. |
| `vary_shop_task_values_by_product` | Live `ensure_auto_task_cycle` explicitly weights task values/rewards by `shop_offers.task_weight`; 12 active offers have product IDs and positive weights. | Live effect verified; a [reference-only snapshot of the current function](/tryforsuccess1/AegisPay-Pro/blob/main/docs/recovered-sql/ensure_auto_task_cycle_live_reference_20261013.sql) is preserved outside the migrations folder, but the original historical migration SQL remains missing. |
| `deduct_shop_task_value_from_balance` | Live `complete_shop_task` deducts the assigned task value and writes `SHOP_TASK_DEBIT`. | Effect verified in live transactional RPC test; exact historical body not recovered. |
| `secure_shop_cycle_checkout_service_role` | Current checkout function has an empty search path, checks runtime and purchase confirmation, and is executable by `service_role` only. | Effect verified; current source has superseded intermediate revisions. |
| `restrict_shop_cycle_checkout_to_service_role` | Authenticated execution is disabled; service-role execution is enabled. | Effect verified; do not replay blindly. |
| `20261008_finalize_ai_approval_policy` | Legacy GitHub commits for this period modify the `submit-deposit` and `submit-kyc` Edge Function policy code; the exact standalone SQL submission is absent from the current migration folder. | Application-code lineage found; historical SQL body unavailable. |
| `20261009_shop_purchase_confirmation_workflow_v2` | Four purchase-confirmation columns and the purchase RPC exist; completion/checkout enforce confirmation. | Semantic source/effect match with `20261009_shop_purchase_confirmation_workflow.sql`; do not replay blindly. |
| `normalize_production_environment_guard` | Live `set_production_config` rejects unsafe live-deposit/payout combinations; current settings remain fail-closed. | Current guard verified; historical original SQL unavailable. |
| `secure_mainnet_deposit_monitor_schedule` | The Mainnet monitor cron job is active every minute and uses `net.http_post` to the current Edge Function. | Runtime schedule verified; original scheduling SQL unavailable. |
| `restore_single_admin_withdrawal_flow` | Current workflow uses a Master Admin panel decision plus a separate human Telegram decision before any debit. | Current workflow verified by transactional test; historical original SQL unavailable. |
| `restrict_shop_cycle_checkout_authenticated` | Current checkout RPC cannot be executed by the authenticated role. | Effect verified. |
| `restrict_legacy_task_completion_rpc` | The legacy `complete_task(uuid)` RPC cannot be executed by the authenticated role. | Effect verified. |

The table distinguishes a verified current result from recovery of the exact original migration text. They are not the same thing.

### Transactional tests performed against the existing project

The SQL executor's explicit `BEGIN / ROLLBACK` path was verified first. Subsequent tests used synthetic records inside a transaction and rolled that transaction back. They did not create a separate database or commit test records.

1. **Weighted task distribution — 36 read-only scenarios.** Six enabled tiers were evaluated at balances of 10.00, 10.01, 25.00, 99.99, 1,000.01, and 12,345.67. All 36 scenarios allocated the exact balance and expected reward after rounding; zero value/reward mismatches. No active Shop offer lacked a product or had a non-positive weight.
2. **Shop RPC happy path.** A synthetic Tier 1 client with a 100.00 balance triggered two weighted tasks. Valid product confirmation, each task debit, one negative ledger row per task, idempotent repeat completion, and the final `WAITING_18H` cycle state all passed.
3. **Shop RPC rejection guards.** Completion without purchase confirmation was rejected without a debit; a wrong product ID was rejected without marking the purchase confirmed; the valid product then completed normally.
4. **Withdrawal dual approval.** Both approval orders passed: Telegram-first and Master-Admin-first. A single approval did not debit funds, the second approval wrote one debit, repeated decisions were rejected, and panel rejection released the reservation without a debit.
5. **Post-rollback integrity.** Synthetic users, Shop tasks/cycles, withdrawals, account-ledger entries, notifications, and audit events all returned to zero remaining rows. Live counts remained at 4 users, 10 tasks, 4 cycles, 17 account-ledger rows, 1 existing withdrawal, and 0 deposit submissions. Migration history remained at 83 rows; no approved/processing withdrawal without a payout TXID was found. Production settings remained locked in PRE_PRODUCTION, and zero public SECURITY DEFINER functions were found without an empty search path.



6. **Production-config negative gates.** In a separate rolled-back transaction, a synthetic active Master Admin attempted four unsafe configurations. The live RPC rejected live deposits in PRE_PRODUCTION, payouts without go-live approval, payouts while the payout lock was closed, and live deposits without payouts enabled. The test asserted that `production_config` and `system_mode` stayed unchanged for these rejected attempts; the synthetic admin and audit rows were zero after rollback. No valid go-live activation was attempted.

These are integration checks for the existing Shop and withdrawal database workflows. They do not validate a real on-chain deposit: the deposit table is empty and real deposits are intentionally disabled.

## Updated status

**Live operational state and the tested Shop/withdrawal paths: verified by read-only checks and rolled-back synthetic RPC tests.**

**Migration history/source reconciliation: improved but still not fully closed.** Current effects have now been mapped for the 23 ledger names that lack normalized one-to-one source filenames, but several original submitted SQL bodies—especially the earliest foundation migrations and the weighted-task update—remain absent from the canonical migration history. The current weighted-task function has been preserved as a clearly labeled reference-only snapshot outside `database/migrations/`; it is not claimed to be the original SQL. No missing migration was replayed, no migration history row was edited, and no synthetic test data was committed.


## Follow-up: deposit-credit hardening prepared in PR #15

The follow-up source change is on branch `fix/deposit-idempotency-and-migration-tests-20261013` and remains a forward-only candidate until reviewed and rolled out deliberately.

- Adds a unique index on normalized `network + txid` and a preflight that refuses to build it if legacy rows are missing a network or duplicate transaction references exist.
- Replaces the source definition of `apply_verified_deposit` so it validates approved evidence, the 64-character transaction ID, exact six-decimal raw USDT amount, recorded network, idempotent row state, fixed empty `search_path`, and service-role-only execution. It uses configured referral rewards rather than hard-coded amounts.
- Hardens `set_production_config` and all three Edge routes (`submit-deposit`, `verify-deposit`, `monitor-deposits`) to require the official TRON Mainnet USDT token contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`; readiness reports that contract check explicitly.
- Persisting the submitted network, validating amount precision, and correcting the Telegram approver separator parser are included. CI now type-checks the three deposit Edge Functions with Deno.
- Disposable PostgreSQL 17 tests cover duplicate TXIDs, networkless/mismatched legacy submissions, configured referral values and idempotency, raw-amount mismatch, malformed TXID, unapproved evidence, fake token contract, Mainnet-live-deposit gate, RPC grants, and Testnet behavior. Latest recorded run on candidate commit `fa9f70397878c0ebcf5b601e564099f85cddf283`: SQL migration tests PASS and repository CI/type-check PASS.

**Deployment boundary:** This source migration has not been applied to the live Supabase project, and the Edge Functions have not been deployed by this PR. The live project's deposit submissions were zero during the last read-only scan, with production still `PRE_PRODUCTION`, live deposits disabled, real payouts disabled, go-live approval false, and payout lock closed. Do not unlock mainnet based on synthetic tests alone. A real TRON on-chain end-to-end deposit is still unverified.

**Migration history is still partially reconciled:** this new candidate file changes the repository-side file count only; it does not change the live ledger's 83 applied records. The original SQL for several early ledger records remains unavailable, so a guaranteed clean fresh-bootstrap path is still not claimed.
