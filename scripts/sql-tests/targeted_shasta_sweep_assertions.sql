-- Assertions for the optional target-deposit selector in the sweep journal.
DO $tests$
DECLARE
  v_target_wallet uuid;
  v_pending_wallet uuid;
  v_legacy_wallet uuid;
  v_failed boolean := false;
  v_target_txid text := repeat('c',64);
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

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='deposit_wallet_sweeps'
      AND indexname='deposit_wallet_sweeps_one_pending_per_wallet_uidx'
      AND indexdef ILIKE '%UNIQUE INDEX%'
      AND indexdef ILIKE '%FAILED_REVIEW%'
  ) THEN
    RAISE EXCEPTION 'one unresolved sweep per wallet index missing';
  END IF;

  INSERT INTO public.deposit_wallets(user_id,network,address,derivation_index,wallet_root_fingerprint,token_contract)
  VALUES ('66666666-6666-4666-8666-666666666666','TRON TESTNET','T'||repeat('5',33),2,repeat('c',64),'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs')
  RETURNING id INTO v_target_wallet;

  INSERT INTO public.deposit_wallet_sweeps(
    deposit_wallet_id,network,token_contract,treasury_address,amount_raw,
    idempotency_key,target_deposit_txid,status
  ) VALUES (
    v_target_wallet,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
    'T'||repeat('3',33),100000000,repeat('a',64),v_target_txid,'PREPARED'
  );

  -- A completed journal releases the one-pending slot but the target TXID remains unique.
  UPDATE public.deposit_wallet_sweeps
  SET status='CONFIRMED',txid=repeat('9',64),
      signed_transaction=jsonb_build_object('txID',repeat('9',64),'signature',jsonb_build_array('synthetic')),
      transaction_expiration_ms=2000000000000,confirmed_at=now()
  WHERE deposit_wallet_id=v_target_wallet AND target_deposit_txid=v_target_txid;

  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallet_sweeps(
      deposit_wallet_id,network,token_contract,treasury_address,amount_raw,
      idempotency_key,target_deposit_txid,status
    ) VALUES (
      v_target_wallet,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
      'T'||repeat('3',33),100000000,repeat('b',64),upper(v_target_txid),'PREPARED'
    );
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'same target deposit TXID accepted twice for one wallet'; END IF;

  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallet_sweeps(
      deposit_wallet_id,network,token_contract,treasury_address,amount_raw,
      idempotency_key,target_deposit_txid,status
    ) VALUES (
      v_target_wallet,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
      'T'||repeat('3',33),100000000,repeat('e',64),'not-a-txid','PREPARED'
    );
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'malformed target TXID accepted'; END IF;

  INSERT INTO public.deposit_wallets(user_id,network,address,derivation_index,wallet_root_fingerprint,token_contract)
  VALUES ('77777777-7777-4777-8777-777777777777','TRON TESTNET','T'||repeat('6',33),3,repeat('c',64),'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs')
  RETURNING id INTO v_pending_wallet;

  INSERT INTO public.deposit_wallet_sweeps(
    deposit_wallet_id,network,token_contract,treasury_address,amount_raw,
    idempotency_key,target_deposit_txid,status
  ) VALUES (
    v_pending_wallet,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
    'T'||repeat('3',33),100000000,repeat('f',64),repeat('b',64),'FAILED_REVIEW'
  );

  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_wallet_sweeps(
      deposit_wallet_id,network,token_contract,treasury_address,amount_raw,
      idempotency_key,target_deposit_txid,status
    ) VALUES (
      v_pending_wallet,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
      'T'||repeat('3',33),500000000,repeat('d',64),repeat('e',64),'PREPARED'
    );
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'multiple unresolved sweep journals accepted for one wallet'; END IF;

  INSERT INTO public.deposit_wallets(user_id,network,address,derivation_index,wallet_root_fingerprint,token_contract)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','TRON TESTNET','T'||repeat('7',33),4,repeat('c',64),'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs')
  RETURNING id INTO v_legacy_wallet;

  -- NULL target remains valid for the pre-existing full-snapshot journal flow.
  INSERT INTO public.deposit_wallet_sweeps(
    deposit_wallet_id,network,token_contract,treasury_address,amount_raw,
    idempotency_key,target_deposit_txid,status
  ) VALUES (
    v_legacy_wallet,'TRON TESTNET','TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
    'T'||repeat('3',33),1000000,repeat('1',64),NULL,'PREPARED'
  );
END;
$tests$;
SELECT 'Targeted Shasta sweep journal assertions: PASS' AS result;
