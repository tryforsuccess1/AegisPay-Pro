-- Adds the missing covering index for the manual approver foreign key.
-- This migration is safe to re-run and does not change or remove existing data.
CREATE INDEX IF NOT EXISTS deposit_submissions_manual_approved_by_idx
  ON public.deposit_submissions (manual_approved_by);
