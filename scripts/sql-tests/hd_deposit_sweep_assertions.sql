-- Disposable PostgreSQL assertions for HD sweep journal safety.
DO $tests$
DECLARE
  v_wallet_id uuid;
  v_sweep_id uuid;
  v_item_count integer;
  v_failed boolean := false;
  v_txid text := repeat('f',64);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='deposit_wallet_sweeps') THEN RAISE EXCEPTION 'sweep journal missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='deposit_wallet_sweep_items') THEN RAISE EXCEPTION 'sweep item journal missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deposit_wallet_sweeps' AND column_name='signed_transaction') THEN RAISE EXCEPTION 'signed transaction persistence missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='deposit_wallet_sweeps' AND c.relrowsecurity IS TRUE) THEN RAISE EXCEPTION 'sweep journal RLS missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='deposit_wallet_sweep_items' AND c.relrowsecurity IS TRUE) THEN RAISE EXCEPTION 'sweep item journal RLS missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('deposit_wallet_sweeps','deposit_wallet_sweep_items')) THEN RAISE EXCEPTION 'sweep journals must not expose direct client policies'; END IF;
  IF has_table_privilege('anon','public.deposit_wallet_sweeps','SELECT') OR has_table_privilege('authenticated','public.deposit_wallet_sweeps','SELECT') THEN RAISE EXCEPTION 'client can read sweep journal'; END IF;
  IF has_table_privilege('anon','public.deposit_wallet_sweep_items','SELECT') OR has_table_privilege('authenticated','public.deposit_wallet_sweep_items','SELECT') THEN RAISE EXCEPTION 'client can read sweep item journal'; END IF;
  IF NOT has_table_privilege('service_role','public.deposit_wallet_sweeps','INSERT') OR NOT has_table_privilege('service_role','public.deposit_wallet_sweeps','UPDATE') THEN RAISE EXCEPTION 'service_role cannot manage sweep journal'; END IF;
  IF NOT has_table_privilege('service_role','public.deposit_wallet_sweep_items','INSERT') THEN RAISE EXCEPTION 'service_role cannot manage sweep item journal'; END IF;

  SELECT id INTO v_wallet_id FROM public.deposit_wallets
  WHERE user_id='11111111-1111-4111-8111-111111111111' AND network='TRON TESTNET';
  IF v_wallet_id IS NULL THEN RAISE EXCEPTION 'HD wallet fixture did not create a testnet address'; END IF;

  UPDATE public.deposit_submissions
  SET deposit_wallet_id=v_wallet_id, receiving_address='T'||repeat('4',33)
  WHERE id='22222222-2222-4222-8222-222222222222';

  INSERT INTO public.deposit_wallet_sweeps(deposit_wallet_id,network,token_contract,treasury_address,amount_raw,idempotency_key)
  VALUES (v_wallet_id,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs','T'||repeat('3',33),1000000,repeat('a',64))
  RETURNING id INTO v_sweep_id;

  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallet_sweeps(deposit_wallet_id,network,token_contract,treasury_address,amount_raw,idempotency_key)
    VALUES (v_wallet_id,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs','T'||repeat('3',33),1000000,repeat('a',64));
  EXCEPTION WHEN unique_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'duplicate wallet sweep idempotency key accepted'; END IF;

  UPDATE public.deposit_wallet_sweeps
  SET status='SIGNED', txid=v_txid,
      signed_transaction=jsonb_build_object('txID',v_txid,'raw_data',jsonb_build_object('expiration',2000000000000),'signature',jsonb_build_array('synthetic-test-signature')),
      transaction_expiration_ms=2000000000000
  WHERE id=v_sweep_id;
  IF NOT EXISTS (SELECT 1 FROM public.deposit_wallet_sweeps WHERE id=v_sweep_id AND status='SIGNED' AND txid=v_txid AND signed_transaction IS NOT NULL) THEN
    RAISE EXCEPTION 'signed transaction persistence state invalid';
  END IF;

  INSERT INTO public.deposit_wallet_sweep_items(sweep_id,deposit_submission_id,deposit_txid,amount_raw)
  VALUES (v_sweep_id,'22222222-2222-4222-8222-222222222222','abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',100000000);
  SELECT count(*) INTO v_item_count FROM public.deposit_wallet_sweep_items WHERE sweep_id=v_sweep_id;
  IF v_item_count <> 1 THEN RAISE EXCEPTION 'source deposit transaction was not journaled'; END IF;

  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallet_sweeps(deposit_wallet_id,network,token_contract,treasury_address,amount_raw,idempotency_key,txid)
    VALUES (v_wallet_id,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs','T'||repeat('3',33),1000000,repeat('b',64),v_txid);
  EXCEPTION WHEN unique_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'duplicate sweep txid accepted'; END IF;

  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallet_sweep_items(sweep_id,deposit_submission_id,deposit_txid,amount_raw)
    VALUES (v_sweep_id,'22222222-2222-4222-8222-222222222222','abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',100000000);
  EXCEPTION WHEN unique_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'duplicate source deposit item accepted'; END IF;
END;
$tests$;
SELECT 'HD sweep journal assertions: PASS' AS result;
