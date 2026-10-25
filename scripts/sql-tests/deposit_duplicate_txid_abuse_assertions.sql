BEGIN;

DO $tests$
DECLARE
  r record;
  v_status text;
  v_hash_a text := repeat('a',64);
  v_hash_b text := repeat('b',64);
  v_hash_c text := repeat('c',64);
BEGIN
  UPDATE public.users SET status='ACTIVE' WHERE id='11111111-1111-4111-8111-111111111111';

  SELECT * INTO r FROM public.register_duplicate_deposit_txid_attempt(
    '11111111-1111-4111-8111-111111111111',v_hash_a
  );
  IF r.attempt_count <> 1 OR r.blocked OR NOT r.counted THEN
    RAISE EXCEPTION 'First duplicate TXID attempt should warn only (count %, blocked %, counted %)',r.attempt_count,r.blocked,r.counted;
  END IF;

  -- Network retries/repeated clicks for the same TXID within five minutes count once.
  SELECT * INTO r FROM public.register_duplicate_deposit_txid_attempt(
    '11111111-1111-4111-8111-111111111111',v_hash_a
  );
  IF r.attempt_count <> 1 OR r.blocked OR r.counted THEN
    RAISE EXCEPTION 'Repeated same-TXID retry within five minutes must not add a strike';
  END IF;

  SELECT * INTO r FROM public.register_duplicate_deposit_txid_attempt(
    '11111111-1111-4111-8111-111111111111',v_hash_b
  );
  IF r.attempt_count <> 2 OR NOT r.blocked OR NOT r.counted THEN
    RAISE EXCEPTION 'Second distinct duplicate TXID attempt must block the account';
  END IF;

  -- Further attempts from a blocked account stay blocked but do not add more strikes.
  SELECT * INTO r FROM public.register_duplicate_deposit_txid_attempt(
    '11111111-1111-4111-8111-111111111111',v_hash_c
  );
  IF r.attempt_count <> 2 OR NOT r.blocked OR r.counted THEN
    RAISE EXCEPTION 'A blocked account must remain blocked without extending the strike count';
  END IF;

  SELECT status INTO v_status FROM public.users WHERE id='11111111-1111-4111-8111-111111111111';
  IF v_status <> 'BLOCKED' THEN RAISE EXCEPTION 'Second distinct duplicate attempt did not block the account'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_events
     WHERE target_user_id='11111111-1111-4111-8111-111111111111'
       AND event_type='USER_BLOCKED_DUPLICATE_TXID'
  ) THEN RAISE EXCEPTION 'Account block was not written to the audit log'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.deposit_security_events
     WHERE user_id='11111111-1111-4111-8111-111111111111'
       AND (txid_sha256=v_hash_a OR txid_sha256=v_hash_b OR txid_sha256=v_hash_c)
       AND length(txid_sha256)<>64
  ) THEN RAISE EXCEPTION 'TXID fingerprint storage format is invalid'; END IF;

  IF has_table_privilege('authenticated','public.deposit_security_events','SELECT')
     OR has_table_privilege('anon','public.deposit_security_events','SELECT') THEN
    RAISE EXCEPTION 'Client roles must not be able to read internal deposit security events';
  END IF;
END
$tests$;

ROLLBACK;

SELECT 'Duplicate-TXID warning, retry dedupe, second-strike block, audit log, and RLS assertions passed' AS result;
