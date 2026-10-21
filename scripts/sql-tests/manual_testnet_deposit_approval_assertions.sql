-- Runtime tests for one-click, allowlisted Shasta testnet manual approval.
DO $tests$
DECLARE
  v_deposit public.deposit_submissions;
  v_balance numeric;
  v_principal numeric;
  v_ledger_count integer;
  v_failed boolean;
  v_status text;
BEGIN
  INSERT INTO public.platform_settings(key,value_json) VALUES
    ('shasta_testnet_rules','{"network":"TRON TESTNET","token_contract":"TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs","receiving_address":"TH7NgA7G17X4hm88SPL9TPptnmsSx7PbMR"}'::jsonb),
    ('deposit_rules','{"network":"TRON MAINNET","token_contract":"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","receiving_address":"TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn"}'::jsonb),
    ('system_mode','{"mode":"MAINNET","live_deposits":false,"real_payouts":false,"production_go_live_approved":false}'::jsonb),
    ('production_config','{"environment":"PRE_PRODUCTION","live_deposits_enabled":false,"real_payouts_enabled":false,"go_live_approved":false,"payouts_locked":true}'::jsonb)
  ON CONFLICT(key) DO UPDATE SET value_json=EXCLUDED.value_json;

  INSERT INTO public.users(id,referred_by)
  VALUES('88888888-8888-4888-8888-888888888888',NULL)
  ON CONFLICT(id) DO NOTHING;

  INSERT INTO public.shasta_test_users(user_id,enabled,purpose)
  VALUES('88888888-8888-4888-8888-888888888888',true,'manual approval test fixture')
  ON CONFLICT(user_id) DO UPDATE SET enabled=true,purpose=EXCLUDED.purpose,updated_at=now();

  INSERT INTO public.deposit_wallets(
    id,user_id,network,address,derivation_index,wallet_root_fingerprint,token_contract,status
  ) VALUES (
    '44444444-4444-4444-8444-444444444444',
    '88888888-8888-4888-8888-888888888888',
    'TRON TESTNET',
    ('T' || repeat('A',33)),
    56,repeat('b',64),'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs','ACTIVE'
  )
  ON CONFLICT(id) DO NOTHING;

  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,credited_amount,status,ai_review_status,
    ai_review_reason,ai_reviewed_at,txid,submitted_txid,network,token_contract,
    deposit_wallet_id,receiving_address,screenshot_path
  ) VALUES (
    '33333333-3333-4333-8333-333333333333',
    '88888888-8888-4888-8888-888888888888',
    'tier-a',10.00,0.00,10.00,'PENDING_VERIFICATION','MANUAL_APPROVED',
    'MASTER_ADMIN_APPROVED',now(),NULL,NULL,'TRON TESTNET',
    'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
    '44444444-4444-4444-8444-444444444444',
    ('T' || repeat('A',33)),
    'test-evidence/manual-testnet.png'
  );

  v_deposit := public.apply_manual_testnet_deposit_approval(
    '33333333-3333-4333-8333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  IF v_deposit.status <> 'VERIFIED'
     OR v_deposit.verification_source <> 'MASTER_ADMIN_TESTNET_MANUAL'
     OR v_deposit.txid IS NOT NULL
     OR v_deposit.manual_approved_by IS DISTINCT FROM 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
     OR v_deposit.ai_review_status <> 'MANUAL_APPROVED' THEN
    RAISE EXCEPTION 'Manual testnet approval did not produce the expected verified test credit';
  END IF;

  -- Idempotent repeat must not issue a second credit.
  PERFORM public.apply_manual_testnet_deposit_approval(
    '33333333-3333-4333-8333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );

  SELECT current_platform_balance, principal_balance
    INTO v_balance, v_principal
    FROM public.users WHERE id='88888888-8888-4888-8888-888888888888';
  SELECT count(*) INTO v_ledger_count
    FROM public.account_ledger
    WHERE reference_id='33333333-3333-4333-8333-333333333333'
      AND entry_type='USER_DEPOSIT'
      AND metadata->>'verification_source'='MASTER_ADMIN_TESTNET_MANUAL';
  IF v_balance <> 10.00 OR v_principal <> 10.00 OR v_ledger_count <> 1 THEN
    RAISE EXCEPTION 'Manual testnet approval must credit once and only once (balance %, principal %, ledger %)',v_balance,v_principal,v_ledger_count;
  END IF;

  -- A client cannot call the SECURITY DEFINER routine as the actor.
  v_failed := false;
  BEGIN
    PERFORM public.apply_manual_testnet_deposit_approval(
      '33333333-3333-4333-8333-333333333333',
      '88888888-8888-4888-8888-888888888888'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'A non-admin user must not be able to invoke manual testnet approval';
  END IF;

  -- Use a fresh Mainnet row here; earlier legacy deposit assertions may change the fixture's first deposit.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,credited_amount,status,ai_review_status,
    txid,submitted_txid,network,token_contract
  ) VALUES (
    '99999999-9999-4999-8999-999999999999',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',10.00,0.00,10.00,'PENDING_VERIFICATION','APPROVED',
    repeat('b',64),NULL,'TRON MAINNET','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
  );

  -- Mainnet may never be credited by this no-TXID manual path.
  v_failed := false;
  BEGIN
    PERFORM public.apply_manual_testnet_deposit_approval(
      '99999999-9999-4999-8999-999999999999',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  SELECT status INTO v_status FROM public.deposit_submissions
    WHERE id='99999999-9999-4999-8999-999999999999';
  IF NOT v_failed OR v_status <> 'PENDING_VERIFICATION' THEN
    RAISE EXCEPTION 'Mainnet deposit must be denied by the manual testnet-only approval path';
  END IF;
END;
$tests$;

SELECT 'Master Admin simple approve/reject test: PASS' AS result;
