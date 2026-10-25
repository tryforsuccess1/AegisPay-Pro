BEGIN;

DO $tests$
DECLARE
  v_column boolean;
  v_check boolean;
  v_unique boolean;
  v_failed boolean;
  v_count integer;
  v_hash text := repeat('a',64);
  v_txid_hint text := repeat('1',64);
  v_actual_txid text := repeat('9',64);
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

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND tablename='deposit_submissions'
       AND indexname='deposit_submissions_shasta_submitted_txid_uq'
       AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
       AND indexdef ILIKE '%a-f0-9%'
  ) INTO v_unique;
  IF NOT v_unique THEN RAISE EXCEPTION 'valid Shasta TXID-hint uniqueness index is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND tablename='deposit_submissions'
       AND indexdef ILIKE 'CREATE UNIQUE INDEX%' AND indexdef ILIKE '%txid%'
  ) THEN RAISE EXCEPTION 'canonical unique TXID index must remain enabled'; END IF;

  -- Same image cannot be used for two active requests, even if network casing/spaces differ.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,status,ai_review_status,txid,network,submitted_txid,evidence_sha256
  ) VALUES (
    'd0000001-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',10,0,'PENDING_VERIFICATION','PENDING_REVIEW',NULL,'TRON TESTNET',v_txid_hint,v_hash
  );

  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_submissions(
      id,user_id,tier_id,gross_amount,deposit_fee,status,ai_review_status,txid,network,submitted_txid,evidence_sha256
    ) VALUES (
      'd0000002-0000-4000-8000-000000000002',
      '11111111-1111-4111-8111-111111111111',
      'tier-a',10,0,'PENDING_VERIFICATION','PENDING_REVIEW',NULL,' tron testnet ',repeat('2',64),v_hash
    );
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Duplicate evidence was accepted for a second active deposit request'; END IF;
  SELECT count(*) INTO v_count FROM public.deposit_submissions
   WHERE id='d0000002-0000-4000-8000-000000000002';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Rejected duplicate-evidence insert left a row behind'; END IF;

  -- A rejected request releases its evidence hash and valid hint so a corrected request can be submitted.
  UPDATE public.deposit_submissions SET status='REJECTED'
   WHERE id='d0000001-0000-4000-8000-000000000001';
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,status,ai_review_status,txid,network,submitted_txid,evidence_sha256
  ) VALUES (
    'd0000003-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',10,0,'PENDING_VERIFICATION','PENDING_REVIEW',NULL,'TRON TESTNET',v_txid_hint,v_hash
  );

  -- The same syntactically valid submitted TXID hint cannot be reserved by two active Shasta requests.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,status,ai_review_status,txid,network,submitted_txid,evidence_sha256
  ) VALUES (
    'd0000004-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',11,0,'PENDING_VERIFICATION','PENDING_REVIEW',NULL,'TRON TESTNET',repeat('d',64),repeat('c',64)
  );
  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_submissions(
      id,user_id,tier_id,gross_amount,deposit_fee,status,ai_review_status,txid,network,submitted_txid,evidence_sha256
    ) VALUES (
      'd0000005-0000-4000-8000-000000000005',
      '11111111-1111-4111-8111-111111111111',
      'tier-a',11,0,'PENDING_VERIFICATION','PENDING_REVIEW',NULL,'tron testnet',repeat('d',64),repeat('e',64)
    );
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Duplicate active Shasta submitted TXID hint was accepted'; END IF;

  -- Malformed hints are not canonical identity and must not block two independent screenshot-first requests.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,status,ai_review_status,txid,network,submitted_txid,evidence_sha256
  ) VALUES
    ('d0000006-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','tier-a',12,0,'PENDING_VERIFICATION','PENDING_REVIEW',NULL,'TRON TESTNET','mistyped-hash',repeat('f',64)),
    ('d0000007-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','tier-a',12,0,'PENDING_VERIFICATION','PENDING_REVIEW',NULL,'TRON TESTNET','mistyped-hash',repeat('0',64));

  -- Reuse of a canonical TXID is rejected at the database boundary, independently of client retries.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,status,ai_review_status,txid,network,submitted_txid,evidence_sha256
  ) VALUES (
    'd0000008-0000-4000-8000-000000000008',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',13,0,'PENDING_VERIFICATION','PENDING_REVIEW',v_actual_txid,'TRON TESTNET',NULL,repeat('b',64)
  );
  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_submissions(
      id,user_id,tier_id,gross_amount,deposit_fee,status,ai_review_status,txid,network,submitted_txid,evidence_sha256
    ) VALUES (
      'd0000009-0000-4000-8000-000000000009',
      '11111111-1111-4111-8111-111111111111',
      'tier-a',13,0,'PENDING_VERIFICATION','PENDING_REVIEW',v_actual_txid,'TRON TESTNET',NULL,repeat('8',64)
    );
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Canonical Shasta TXID was accepted for two different deposit requests'; END IF;
END
$tests$;

ROLLBACK;

SELECT 'Duplicate evidence, submitted-hint, canonical-TXID and rejected-resubmission assertions passed' AS result;
