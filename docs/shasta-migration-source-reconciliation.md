# Shasta migration source reconciliation

This change restores Shasta deposit/sweep migration source files that are present in the live Supabase migration history but absent from the current `main` tree, and adds regression tests to the disposable PostgreSQL workflow.

## Recorded migration versions

The source files are named with the version identifiers reported by Supabase migration history so a future CLI comparison can recognize the existing versions rather than treating the stale feature-branch filenames as new versions:

| Recorded version | Canonical source file |
| --- | --- |
| `20261020190212` | `database/migrations/20261020190212_harden_shasta_deposit_credit_20261020.sql` |
| `20261020194312` | `database/migrations/20261020194312_isolate_shasta_test_credit_side_effects_20261021.sql` |
| `20261020210418` | `database/migrations/20261020210418_allow_shasta_deposit_txid_fallback_20261021.sql` |
| `20261020213216` | `database/migrations/20261020213216_dedupe_shasta_deposit_screenshots_20261021140000.sql` |
| `20261020213915` | `database/migrations/20261020213915_limit_shasta_txid_hint_index_20261021150000.sql` |
| `20261021182655` | `database/migrations/20261021182655_master_admin_testnet_manual_deposit_approval_20261021.sql` |
| `20261021200250` | `database/migrations/20261021200250_deposit_duplicate_txid_abuse_guard_20261022.sql` |
| `20261021203129` | `database/migrations/20261021203129_block_second_duplicate_txid_attempt.sql` |

The manual-approval migration file previously used an abbreviated date-only prefix. Its contents are retained under the recorded 14-digit version and all repository test references use that canonical path.

## Important limitation

The available management connection can inspect the applied migration version/name list and live schema, but it cannot retrieve the exact SQL text that was applied for each historical migration. The restored source text comes from the surviving Shasta feature branch. Before merging this draft, review the reconstructed SQL against the live schema and deployment history; the metadata mapping is not byte-for-byte proof that the source equals the originally applied SQL.

The applied migration `20261023081727_grant_authenticated_exec_production_readiness_master_admin_guard` was also listed in live history, but no source copy was found in the default or surviving Shasta feature branch during this pass. It is deliberately not recreated or guessed here and remains a separate source-history gap.

No remote Supabase migration, production setting, secret, or blockchain transaction is changed by this PR. The workflow additions run migrations only against a disposable PostgreSQL test fixture. Mainnet/live-money gates must remain locked.
