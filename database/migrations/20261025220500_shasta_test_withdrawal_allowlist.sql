-- Explicit, service-only allowlist for individual withdrawals used in Shasta payout tests.
-- A test-user allowlist alone is insufficient: the same account may also have an ordinary customer withdrawal.
BEGIN;

CREATE TABLE IF NOT EXISTS public.shasta_test_withdrawals (
  withdrawal_id uuid PRIMARY KEY REFERENCES public.withdrawal_requests(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  authorized_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shasta_test_withdrawals ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.shasta_test_withdrawals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shasta_test_withdrawals TO service_role;

DROP POLICY IF EXISTS shasta_test_withdrawals_deny_client_access ON public.shasta_test_withdrawals;
CREATE POLICY shasta_test_withdrawals_deny_client_access
  ON public.shasta_test_withdrawals FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.shasta_test_withdrawals IS
  'Explicit per-withdrawal authorization for isolated Shasta payout tests. Test-user allowlisting alone never makes an ordinary withdrawal eligible. Rows default disabled and are service-role-only.';

COMMIT;
