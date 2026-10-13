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
