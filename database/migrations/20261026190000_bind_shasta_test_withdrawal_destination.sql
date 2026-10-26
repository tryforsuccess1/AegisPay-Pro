-- Bind isolated Shasta payout authorization to the exact recipient address.
-- Existing allowlist entries remain non-operative for payout routing until an exact address is recorded.
BEGIN;

ALTER TABLE public.shasta_test_withdrawals
  ADD COLUMN IF NOT EXISTS destination_address text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.shasta_test_withdrawals'::regclass
      AND conname = 'shasta_test_withdrawals_destination_address_format'
  ) THEN
    ALTER TABLE public.shasta_test_withdrawals
      ADD CONSTRAINT shasta_test_withdrawals_destination_address_format
      CHECK (
        destination_address IS NULL
        OR destination_address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.shasta_test_withdrawals.destination_address IS
  'Exact case-sensitive TRON destination authorized for this specific isolated Shasta test withdrawal; null means not authorized for routing.';

COMMIT;
