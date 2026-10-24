BEGIN;

ALTER TABLE public.deposit_submissions
  ADD COLUMN IF NOT EXISTS monitor_last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS deposit_submissions_monitor_rotation_idx
  ON public.deposit_submissions (network, status, ai_review_status, monitor_last_attempt_at, created_at);

COMMENT ON COLUMN public.deposit_submissions.monitor_last_attempt_at IS
  'Last attempt by the background TRON deposit monitor; rotates unmatched pending rows so they cannot permanently pin a network queue.';

COMMIT;
