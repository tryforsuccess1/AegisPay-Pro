BEGIN;

ALTER TABLE public.deposit_submissions
  ADD COLUMN IF NOT EXISTS evidence_sha256 text;

ALTER TABLE public.deposit_submissions
  ADD CONSTRAINT deposit_submissions_evidence_sha256_format
  CHECK (evidence_sha256 IS NULL OR evidence_sha256 ~ '^[a-f0-9]{64}$');

-- Exact same uploaded image cannot be used for a second active/credited deposit
-- on the same chain. Rejected submissions can be corrected and resubmitted.
CREATE UNIQUE INDEX IF NOT EXISTS deposit_submissions_network_evidence_sha256_uq
  ON public.deposit_submissions (lower(btrim(network)), evidence_sha256)
  WHERE evidence_sha256 IS NOT NULL AND status <> 'REJECTED';

-- A submitted TXID remains an untrusted hint, but prevent the same Shasta hint
-- from being claimed by two non-rejected requests, including concurrent inserts.
CREATE UNIQUE INDEX IF NOT EXISTS deposit_submissions_shasta_submitted_txid_uq
  ON public.deposit_submissions (lower(btrim(network)), lower(btrim(submitted_txid)))
  WHERE lower(btrim(submitted_txid)) ~ '^[a-f0-9]{64}

COMMENT ON COLUMN public.deposit_submissions.evidence_sha256 IS
  'SHA-256 digest of the uploaded evidence image. Used for duplicate deposit-evidence detection; never sufficient by itself to credit funds.';

COMMIT;

    AND lower(btrim(network)) = 'tron testnet'
    AND status <> 'REJECTED';

COMMENT ON COLUMN public.deposit_submissions.evidence_sha256 IS
  'SHA-256 digest of the uploaded evidence image. Used for duplicate deposit-evidence detection; never sufficient by itself to credit funds.';

COMMIT;
