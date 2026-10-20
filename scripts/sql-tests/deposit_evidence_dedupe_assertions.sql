DO $$
DECLARE
  v_column boolean;
  v_check boolean;
  v_unique boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='deposit_submissions'
       AND column_name='evidence_sha256' AND data_type='text'
  ) INTO v_column;
  IF NOT v_column THEN RAISE EXCEPTION 'evidence_sha256 column is missing'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.deposit_submissions'::regclass
       AND conname='deposit_submissions_evidence_sha256_format'
  ) INTO v_check;
  IF NOT v_check THEN RAISE EXCEPTION 'evidence_sha256 format constraint is missing'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND tablename='deposit_submissions'
       AND indexname='deposit_submissions_network_evidence_sha256_uq'
       AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
  ) INTO v_unique;
  IF NOT v_unique THEN RAISE EXCEPTION 'duplicate evidence unique index is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND tablename='deposit_submissions'
       AND indexname='deposit_submissions_shasta_submitted_txid_uq'
       AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
       AND indexdef ILIKE '%a-f0-9%'
  ) THEN RAISE EXCEPTION 'submitted TXID uniqueness must apply only to valid 64-character hex hints'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND tablename='deposit_submissions'
       AND indexname='deposit_submissions_shasta_submitted_txid_uq'
       AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
  ) THEN RAISE EXCEPTION 'duplicate Shasta submitted TXID hint index is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND tablename='deposit_submissions'
       AND indexdef ILIKE 'CREATE UNIQUE INDEX%' AND indexdef ILIKE '%txid%'
  ) THEN RAISE EXCEPTION 'canonical unique TXID index must remain enabled'; END IF;
END $$;

SELECT 'Duplicate deposit evidence schema assertions passed' AS result;
