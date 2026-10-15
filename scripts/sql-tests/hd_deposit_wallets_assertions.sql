-- Disposable PostgreSQL assertions for the HD deposit-wallet migration.
DO $tests$
DECLARE v_wallet_id uuid; v_failed boolean := false; v_function regprocedure := to_regprocedure('public.next_tron_deposit_address_index()');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deposit_submissions' AND column_name='deposit_wallet_id') THEN RAISE EXCEPTION 'deposit_wallet_id missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deposit_submissions' AND column_name='receiving_address') THEN RAISE EXCEPTION 'receiving_address missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='deposit_wallets' AND c.relrowsecurity IS TRUE) THEN RAISE EXCEPTION 'deposit_wallets RLS missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='deposit_wallets') THEN RAISE EXCEPTION 'deposit_wallets must not expose direct client policies'; END IF;
  IF has_table_privilege('anon','public.deposit_wallets','SELECT') OR has_table_privilege('authenticated','public.deposit_wallets','SELECT') THEN RAISE EXCEPTION 'Client role can read deposit_wallets'; END IF;
  IF has_function_privilege('anon',v_function,'EXECUTE') OR has_function_privilege('authenticated',v_function,'EXECUTE') THEN RAISE EXCEPTION 'Client role can allocate addresses'; END IF;
  IF NOT has_function_privilege('service_role',v_function,'EXECUTE') THEN RAISE EXCEPTION 'service_role cannot allocate addresses'; END IF;
  INSERT INTO public.deposit_wallets(user_id,network,address,derivation_index,wallet_root_fingerprint,token_contract)
  VALUES ('11111111-1111-4111-8111-111111111111','TRON MAINNET','TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn',1,repeat('a',64),'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') RETURNING id INTO v_wallet_id;
  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallets(user_id,network,address,derivation_index,wallet_root_fingerprint,token_contract)
    VALUES ('66666666-6666-4666-8666-666666666666','TRON MAINNET','TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn',2,repeat('b',64),'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  EXCEPTION WHEN unique_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Duplicate address assignment accepted'; END IF;
  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallets(user_id,network,address,derivation_index,wallet_root_fingerprint,token_contract)
    VALUES ('66666666-6666-4666-8666-666666666666','TRON MAINNET','T'||repeat('2',33),1,repeat('b',64),'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  EXCEPTION WHEN unique_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Duplicate network derivation index accepted'; END IF;
  IF (SELECT count(*) FROM public.deposit_wallets WHERE id=v_wallet_id) <> 1 THEN RAISE EXCEPTION 'HD deposit wallet record missing'; END IF;
END;
$tests$;
SELECT 'HD deposit-wallet migration assertions: PASS' AS result;
