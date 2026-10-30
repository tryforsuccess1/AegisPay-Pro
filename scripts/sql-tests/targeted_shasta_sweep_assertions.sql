-- Assertions for the optional target-deposit selector in the sweep journal.
DO $tests$
DECLARE
  v_wallet_id uuid;
  v_target_txid text := repeat('c',64);
  v_failed boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='deposit_wallet_sweeps'
      AND column_name='target_deposit_txid'
  ) THEN
    RAISE EXCEPTION 'target_deposit_txid column missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.deposit_wallet_sweeps'::regclass
      AND conname='deposit_wallet_sweeps_target_deposit_txid_check'
  ) THEN
    RAISE EXCEPTION 'target TXID format constraint missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='deposit_wallet_sweeps'
      AND indexname='deposit_wallet_sweeps_wallet_target_txid_uidx'
      AND indexdef ILIKE '%UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'per-wallet target TXID uniqueness index missing';
  END IF;

  SELECT id INTO v_wallet_id
  FROM public.deposit_wallets
  ORDER BY id
  LIMIT 1;
  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'disposable sweep wallet fixture missing';
  END IF;

  INSERT INTO public.deposit_wallet_sweeps(
    deposit_wallet_id,network,token_contract,treasury_address,amount_raw,
    idempotency_key,target_deposit_txid,status
  ) VALUES (
    v_wallet_id,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
    'T'||repeat('3',33),100000000,repeat('d',64),v_target_txid,'PREPARED'
  );

  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallet_sweeps(
      deposit_wallet_id,network,token_contract,treasury_address,amount_raw,
      idempotency_key,target_deposit_txid,status
    ) VALUES (
      v_wallet_id,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
      'T'||repeat('3',33),100000000,repeat('e',64),v_target_txid,'PREPARED'
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'same target deposit TXID accepted twice for one wallet';
  END IF;

  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallet_sweeps(
      deposit_wallet_id,network,token_contract,treasury_address,amount_raw,
      idempotency_key,target_deposit_txid,status
    ) VALUES (
      v_wallet_id,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
      'T'||repeat('3',33),100000000,repeat('f',64),'not-a-txid','PREPARED'
    );
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'malformed target TXID accepted';
  END IF;

  -- NULL target is intentionally retained for the legacy full-snapshot journal.
  INSERT INTO public.deposit_wallet_sweeps(
    deposit_wallet_id,network,token_contract,treasury_address,amount_raw,
    idempotency_key,target_deposit_txid,status
  ) VALUES (
    v_wallet_id,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
    'T'||repeat('3',33),1000000,repeat('1',64),NULL,'PREPARED'
  );
END;
$tests$;
SELECT 'Targeted Shasta sweep journal assertions: PASS' AS result;
