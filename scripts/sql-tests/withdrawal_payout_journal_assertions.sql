-- Must run only against the disposable PostgreSQL fixture.
DO $tests$
DECLARE
  v_first bigint;
  v_second bigint;
  v_user uuid;
  v_withdrawal uuid;
  v_test_withdrawal uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='withdrawal_payout_journal' AND c.relrowsecurity
  ) THEN RAISE EXCEPTION 'withdrawal_payout_journal must have RLS enabled'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='withdrawal_payout_journal'
      AND policyname='withdrawal_payout_journal_deny_client_access'
      AND cmd='ALL' AND roles @> ARRAY['anon'::name,'authenticated'::name]
      AND coalesce(qual,'')='false' AND coalesce(with_check,'')='false'
  ) THEN RAISE EXCEPTION 'withdrawal_payout_journal must have a deny-all client RLS policy'; END IF;

  IF has_table_privilege('anon','public.withdrawal_payout_journal','SELECT')
     OR has_table_privilege('anon','public.withdrawal_payout_journal','INSERT')
     OR has_table_privilege('authenticated','public.withdrawal_payout_journal','SELECT')
     OR has_table_privilege('authenticated','public.withdrawal_payout_journal','INSERT')
     OR has_table_privilege('authenticated','public.withdrawal_payout_journal','UPDATE') THEN
    RAISE EXCEPTION 'Public/authenticated roles must not directly access payout journal';
  END IF;

  IF NOT has_table_privilege('service_role','public.withdrawal_payout_journal','SELECT')
     OR NOT has_table_privilege('service_role','public.withdrawal_payout_journal','INSERT')
     OR NOT has_table_privilege('service_role','public.withdrawal_payout_journal','UPDATE')
     OR NOT has_table_privilege('service_role','public.withdrawal_payout_journal','DELETE') THEN
    RAISE EXCEPTION 'service_role is missing journal table privileges';
  END IF;

  IF has_function_privilege('anon','public.next_tron_withdrawal_payout_index()','EXECUTE')
     OR has_function_privilege('authenticated','public.next_tron_withdrawal_payout_index()','EXECUTE')
     OR has_function_privilege('public','public.next_tron_withdrawal_payout_index()','EXECUTE') THEN
    RAISE EXCEPTION 'Payout index allocator must be service_role-only';
  END IF;
  IF NOT has_function_privilege('service_role','public.next_tron_withdrawal_payout_index()','EXECUTE') THEN
    RAISE EXCEPTION 'service_role must be able to allocate payout index';
  END IF;

  v_first := public.next_tron_withdrawal_payout_index();
  v_second := public.next_tron_withdrawal_payout_index();
  IF v_first < 1 OR v_second <= v_first THEN
    RAISE EXCEPTION 'Payout HD index allocator must return increasing unique indices';
  END IF;

  INSERT INTO public.users DEFAULT VALUES RETURNING id INTO v_user;
  INSERT INTO public.withdrawal_requests(user_id) VALUES (v_user) RETURNING id INTO v_withdrawal;
  INSERT INTO public.withdrawal_payout_journal(
    withdrawal_id,user_id,derivation_index,address,root_fingerprint,destination_address,
    net_amount_raw,status,idempotency_key
  ) VALUES (
    v_withdrawal,v_user,1001,'TMLvXm7ho4Pmt3QYWWXmxr6HCB8qwRonKN',
    repeat('a',64),'TMLvXm7ho4Pmt3QYWWXmxr6HCB8qwRonKN',90000000,'PREPARED',
    'withdrawal:'||v_withdrawal::text
  );

  IF (SELECT count(*) FROM public.withdrawal_payout_journal WHERE withdrawal_id=v_withdrawal) <> 1 THEN
    RAISE EXCEPTION 'One journal row per withdrawal must be enforced';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='shasta_test_withdrawals' AND c.relrowsecurity
  ) THEN RAISE EXCEPTION 'shasta_test_withdrawals must have RLS enabled'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='shasta_test_withdrawals'
      AND policyname='shasta_test_withdrawals_deny_client_access'
      AND cmd='ALL' AND roles @> ARRAY['anon'::name,'authenticated'::name]
      AND coalesce(qual,'')='false' AND coalesce(with_check,'')='false'
  ) THEN RAISE EXCEPTION 'shasta_test_withdrawals must have a deny-all client RLS policy'; END IF;
  IF has_table_privilege('anon','public.shasta_test_withdrawals','SELECT')
     OR has_table_privilege('anon','public.shasta_test_withdrawals','INSERT')
     OR has_table_privilege('authenticated','public.shasta_test_withdrawals','SELECT')
     OR has_table_privilege('authenticated','public.shasta_test_withdrawals','INSERT')
     OR has_table_privilege('authenticated','public.shasta_test_withdrawals','UPDATE') THEN
    RAISE EXCEPTION 'Client roles must not access the Shasta test-withdrawal allowlist';
  END IF;
  IF NOT has_table_privilege('service_role','public.shasta_test_withdrawals','SELECT')
     OR NOT has_table_privilege('service_role','public.shasta_test_withdrawals','INSERT')
     OR NOT has_table_privilege('service_role','public.shasta_test_withdrawals','UPDATE')
     OR NOT has_table_privilege('service_role','public.shasta_test_withdrawals','DELETE') THEN
    RAISE EXCEPTION 'service_role must be the only application role with test-withdrawal allowlist access';
  END IF;

  INSERT INTO public.withdrawal_requests(user_id) VALUES (v_user) RETURNING id INTO v_test_withdrawal;
  INSERT INTO public.shasta_test_withdrawals(withdrawal_id, reason)
    VALUES (v_test_withdrawal, 'isolated Shasta test fixture');
  IF (SELECT enabled FROM public.shasta_test_withdrawals WHERE withdrawal_id=v_test_withdrawal) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Shasta test-withdrawal allowlist must default to disabled';
  END IF;
  UPDATE public.shasta_test_withdrawals SET enabled=true, updated_at=now()
    WHERE withdrawal_id=v_test_withdrawal;
  IF NOT EXISTS (
    SELECT 1 FROM public.shasta_test_withdrawals
    WHERE withdrawal_id=v_test_withdrawal AND enabled=true
  ) THEN RAISE EXCEPTION 'Explicitly enabled test-withdrawal allowlist row should be found'; END IF;

  RAISE NOTICE 'Per-withdrawal payout journal and Shasta allowlist assertions passed';
END;
$tests$;

SELECT 'Per-withdrawal payout journal assertions: PASS' AS result;
