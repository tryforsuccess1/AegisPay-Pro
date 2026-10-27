-- Cover the user_id foreign key and account-scoped payout journal lookups.
-- The existing journal is small; this index is additive and does not change payout state.
CREATE INDEX IF NOT EXISTS withdrawal_payout_journal_user_id_idx
  ON public.withdrawal_payout_journal (user_id);

COMMENT ON INDEX public.withdrawal_payout_journal_user_id_idx IS
  'Supports user_id foreign-key maintenance and account-scoped withdrawal payout journal lookups.';
