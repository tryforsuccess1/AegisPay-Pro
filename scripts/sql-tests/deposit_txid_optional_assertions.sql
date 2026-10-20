DO $$
DECLARE
  v_nullable text;
  v_has_submitted_txid boolean;
BEGIN
  SELECT is_nullable INTO v_nullable
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='deposit_submissions'
     AND column_name='txid';
  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'deposit_submissions.txid must be nullable for TXID-less Shasta submissions';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name='deposit_submissions'
       AND column_name='submitted_txid'
  ) INTO v_has_submitted_txid;
  IF NOT v_has_submitted_txid THEN
    RAISE EXCEPTION 'submitted_txid audit column is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public'
       AND tablename='deposit_submissions'
       AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
       AND indexdef ILIKE '%txid%'
  ) THEN
    RAISE EXCEPTION 'A database-enforced unique TXID index must remain enabled';
  END IF;
END $$;

SELECT 'TXID-less Shasta submission schema assertions passed' AS result;
