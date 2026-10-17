-- Disposable PostgreSQL assertions for sweep journal safety.
DO $tests$
DECLARE v_failed boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='deposit_wallet_sweeps') THEN RAISE EXCEPTION 'sweep journal missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='deposit_wallet_sweeps' AND c.relrowsecurity IS TRUE) THEN RAISE EXCEPTION 'sweep journal RLS missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='deposit_wallet_sweeps') THEN RAISE EXCEPTION 'sweep journal must not expose direct client policies'; END IF;
  IF has_table_privilege('anon','public.deposit_wallet_sweeps','SELECT') OR has_table_privilege('authenticated','public.deposit_wallet_sweeps','SELECT') THEN RAISE EXCEPTION 'client can read sweep journal'; END IF;
  IF NOT has_table_privilege('service_role','public.deposit_wallet_sweeps','INSERT') OR NOT has_table_privilege('service_role','public.deposit_wallet_sweeps','UPDATE') THEN RAISE EXCEPTION 'service_role cannot manage sweep journal'; END IF;
  INSERT INTO public.deposit_wallet_sweeps(deposit_wallet_id,network,token_contract,treasury_address,amount_raw,idempotency_key)
  SELECT id, network, token_contract, 'T'||repeat('3',33), 1000000, repeat('a',64)
  FROM public.deposit_wallets WHERE network='TRON TESTNET' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'test fixture has no TRON TESTNET wallet'; END IF;
  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallet_sweeps(deposit_wallet_id,network,token_contract,treasury_address,amount_raw,idempotency_key)
    SELECT id, network, token_contract, 'T'||repeat('3',33), 1000000, repeat('a',64)
    FROM public.deposit_wallets WHERE network='TRON TESTNET' LIMIT 1;
  EXCEPTION WHEN unique_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'duplicate wallet sweep idempotency key accepted'; END IF;
  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallet_sweeps(deposit_wallet_id,network,token_contract,treasury_address,amount_raw,idempotency_key,txid)
    SELECT id, network, token_contract, 'T'||repeat('3',33), 1000000, repeat('b',64), repeat('f',64)
    FROM public.deposit_wallets WHERE network='TRON TESTNET' LIMIT 1;
    INSERT INTO public.deposit_wallet_sweeps(deposit_wallet_id,network,token_contract,treasury_address,amount_raw,idempotency_key,txid)
    SELECT id, network, token_contract, 'T'||repeat('4',33), 1000000, repeat('c',64), repeat('f',64)
    FROM public.deposit_wallets WHERE network='TRON TESTNET' LIMIT 1;
  EXCEPTION WHEN unique_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'duplicate txid accepted'; END IF;
END;
$tests$;
SELECT 'HD sweep journal assertions: PASS' AS result;
