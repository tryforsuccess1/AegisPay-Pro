BEGIN;

DROP INDEX IF EXISTS public.deposit_submissions_shasta_submitted_txid_uq;

-- Only syntactically valid 64-character TXID hints are globally de-duplicated
-- on Shasta. Arbitrary malformed text must not let one user's typo reserve a
-- common string and block another user's independent screenshot-only request.
CREATE UNIQUE INDEX deposit_submissions_shasta_submitted_txid_uq
  ON public.deposit_submissions (lower(btrim(network)), lower(btrim(submitted_txid)))
  WHERE lower(btrim(submitted_txid)) ~ '^[a-f0-9]{64}$'
    AND lower(btrim(network)) = 'tron testnet'
    AND status <> 'REJECTED';

COMMIT;
