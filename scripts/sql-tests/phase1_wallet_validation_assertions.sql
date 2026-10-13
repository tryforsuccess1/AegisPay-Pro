-- Phase 1 wallet validation behavior tests. Must run against the isolated fixture DB.
DO $tests$
DECLARE
  v_valid constant text := 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  v_lower text;
  v_bad_checksum text;
  v_failed boolean;
BEGIN
  v_lower := lower(v_valid);
  v_bad_checksum := left(v_valid, length(v_valid)-1) || 'u';

  IF public.is_valid_tron_address(v_valid) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Known valid exact-case TRON address was rejected';
  END IF;
  IF public.is_valid_tron_address(v_lower) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Lowercased TRON address was accepted';
  END IF;
  IF public.is_valid_tron_address(v_bad_checksum) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Invalid-checksum TRON address was accepted';
  END IF;
  IF public.is_valid_tron_address(NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'NULL TRON address should not validate';
  END IF;

  -- Saved user wallets may remain blank until linked.
  INSERT INTO public.users(id, destination_address)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL),
         ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '');
  INSERT INTO public.users(id, destination_address)
  VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', v_valid);

  v_failed := false;
  BEGIN
    INSERT INTO public.users(id, destination_address)
    VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', v_bad_checksum);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Invalid user wallet insert was not rejected'; END IF;

  v_failed := false;
  BEGIN
    UPDATE public.users SET destination_address = v_bad_checksum
    WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Invalid user wallet update was not rejected'; END IF;

  -- Every withdrawal request requires a valid destination: NULL/blank fail closed.
  INSERT INTO public.withdrawal_requests(id, destination_address)
  VALUES ('11111111-1111-4111-8111-111111111111', v_valid);

  v_failed := false;
  BEGIN
    INSERT INTO public.withdrawal_requests(id, destination_address)
    VALUES ('22222222-2222-4222-8222-222222222222', NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'NULL withdrawal destination was not rejected'; END IF;

  v_failed := false;
  BEGIN
    INSERT INTO public.withdrawal_requests(id, destination_address)
    VALUES ('33333333-3333-4333-8333-333333333333', '');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Blank withdrawal destination was not rejected'; END IF;

  v_failed := false;
  BEGIN
    INSERT INTO public.withdrawal_requests(id, destination_address)
    VALUES ('44444444-4444-4444-8444-444444444444', v_bad_checksum);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Invalid-checksum withdrawal destination was not rejected'; END IF;

  v_failed := false;
  BEGIN
    UPDATE public.withdrawal_requests SET destination_address = NULL
    WHERE id = '11111111-1111-4111-8111-111111111111';
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'NULL withdrawal destination update was not rejected'; END IF;

  v_failed := false;
  BEGIN
    UPDATE public.withdrawal_requests SET destination_address = v_lower
    WHERE id = '11111111-1111-4111-8111-111111111111';
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Lowercased withdrawal destination update was not rejected'; END IF;

  -- Confirm both intended BEFORE triggers exist and cover INSERT + UPDATE.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='users'
      AND t.tgname='users_validate_withdrawal_destination'
      AND NOT t.tgisinternal AND (t.tgtype & 2)=2 AND (t.tgtype & 4)=4
      AND (t.tgtype & 16)=16
  ) THEN RAISE EXCEPTION 'Saved-wallet INSERT/UPDATE trigger is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='withdrawal_requests'
      AND t.tgname='withdrawal_requests_validate_destination'
      AND NOT t.tgisinternal AND (t.tgtype & 2)=2 AND (t.tgtype & 4)=4
      AND (t.tgtype & 16)=16
  ) THEN RAISE EXCEPTION 'Withdrawal-request INSERT/UPDATE trigger is missing'; END IF;

  RAISE NOTICE 'Phase 1 wallet validation tests passed';
END;
$tests$;
