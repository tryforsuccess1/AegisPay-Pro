-- Behavior tests for the deposit-credit migration using a disposable PostgreSQL schema.
DO $tests$
DECLARE
  v_balance numeric;
  v_principal numeric;
  v_user_deposits integer;
  v_failed boolean;
  v_parent_balance numeric;
  v_parent_profit numeric;
  v_grandparent_balance numeric;
  v_grandparent_profit numeric;
  v_referral_entries integer;
  v_function regprocedure := to_regprocedure('public.apply_verified_deposit(uuid,text,text,timestamptz,text)');
BEGIN
  -- A Master Admin must not be able to open Mainnet production when a fake token contract is configured.
  PERFORM set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  UPDATE public.platform_settings
     SET value_json = value_json || '{"token_contract":"TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs"}'::jsonb
   WHERE key='deposit_rules';
  v_failed := false;
  BEGIN
    PERFORM public.set_production_config('PRODUCTION',true,true,true,false);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Production go-live accepted a non-USDT Mainnet token contract'; END IF;
  IF EXISTS (SELECT 1 FROM public.platform_settings WHERE key='production_config') THEN
    RAISE EXCEPTION 'Rejected production go-live unexpectedly wrote production_config';
  END IF;
  IF (SELECT (value_json->>'live_deposits')::boolean FROM public.platform_settings WHERE key='system_mode') IS DISTINCT FROM true
     OR (SELECT (value_json->>'real_payouts')::boolean FROM public.platform_settings WHERE key='system_mode') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Rejected production go-live changed live system flags';
  END IF;
  UPDATE public.platform_settings
     SET value_json = value_json || '{"token_contract":"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"}'::jsonb
   WHERE key='deposit_rules';

  -- The privileged credit function must not be callable directly by public app roles.
  IF has_function_privilege('anon', v_function, 'EXECUTE')
     OR has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Deposit credit RPC is executable by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Deposit credit RPC must remain callable by service_role';
  END IF;

  -- Mainnet credit must succeed when its own flag is enabled. Production config
  -- separately prevents an unsafe combination from being enabled by an admin.
  PERFORM public.apply_verified_deposit(
    '22222222-2222-4222-8222-222222222222',
    'TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn',
    '100000000',
    '2026-10-13T00:00:00Z'::timestamptz,
    'TronGrid'
  );

  SELECT current_platform_balance,principal_balance
    INTO v_balance,v_principal
    FROM public.users WHERE id='11111111-1111-4111-8111-111111111111';
  SELECT count(*) INTO v_user_deposits FROM public.account_ledger
    WHERE entry_type='USER_DEPOSIT'
      AND reference_id='22222222-2222-4222-8222-222222222222';
  IF v_balance <> 100 OR v_principal <> 100 OR v_user_deposits <> 1 THEN
    RAISE EXCEPTION 'Enabled MAINNET deposit should create one exact balance and ledger credit';
  END IF;
  IF (SELECT status FROM public.deposit_submissions
      WHERE id='22222222-2222-4222-8222-222222222222') <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Successful deposit should become VERIFIED';
  END IF;

  -- Use configured referral values, not hard-coded 5/2, and reward each level once.
  SELECT current_platform_balance,profit_balance
    INTO v_parent_balance,v_parent_profit
    FROM public.users WHERE id='66666666-6666-4666-8666-666666666666';
  SELECT current_platform_balance,profit_balance
    INTO v_grandparent_balance,v_grandparent_profit
    FROM public.users WHERE id='77777777-7777-4777-8777-777777777777';
  SELECT count(*) INTO v_referral_entries
    FROM public.account_ledger WHERE entry_type IN ('REFERRAL_L1','REFERRAL_L2');
  IF v_parent_balance <> 3.50 OR v_parent_profit <> 3.50
     OR v_grandparent_balance <> 1.25 OR v_grandparent_profit <> 1.25
     OR v_referral_entries <> 2 THEN
    RAISE EXCEPTION 'Configured referral rewards were not applied exactly once';
  END IF;

  -- A valid-looking but non-USDT Mainnet token must never be credited as USDT.
  UPDATE public.platform_settings
     SET value_json = value_json || '{"token_contract":"TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs"}'::jsonb
   WHERE key='deposit_rules';
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,credited_amount,status,ai_review_status,txid,network
  ) VALUES (
    '12121212-1212-4121-8121-121212121212',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',40.00,0.00,40.00,'PENDING_VERIFICATION','APPROVED',
    'ababab0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    'TRON MAINNET'
  );
  v_failed := false;
  BEGIN
    PERFORM public.apply_verified_deposit(
      '12121212-1212-4121-8121-121212121212',
      'TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn','40000000',
      '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Fake Mainnet token contract was credited as USDT'; END IF;
  IF (SELECT status FROM public.deposit_submissions
      WHERE id='12121212-1212-4121-8121-121212121212') <> 'PENDING_VERIFICATION' THEN
    RAISE EXCEPTION 'Fake-token rejection changed the deposit status'; END IF;
  SELECT current_platform_balance,principal_balance
    INTO v_balance,v_principal
    FROM public.users WHERE id='11111111-1111-4111-8111-111111111111';
  SELECT count(*) INTO v_user_deposits FROM public.account_ledger
    WHERE entry_type='USER_DEPOSIT';
  IF v_balance <> 100 OR v_principal <> 100 OR v_user_deposits <> 1 THEN
    RAISE EXCEPTION 'Fake-token rejection had a partial financial side effect';
  END IF;
  UPDATE public.platform_settings
     SET value_json = value_json || '{"token_contract":"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"}'::jsonb
   WHERE key='deposit_rules';

  -- Repeating the same verified request must have no second financial effect.
  PERFORM public.apply_verified_deposit(
    '22222222-2222-4222-8222-222222222222',
    'TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn','100000000',
    '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
  );
  SELECT current_platform_balance,principal_balance
    INTO v_balance,v_principal
    FROM public.users WHERE id='11111111-1111-4111-8111-111111111111';
  SELECT count(*) INTO v_user_deposits FROM public.account_ledger
    WHERE entry_type='USER_DEPOSIT'
      AND reference_id='22222222-2222-4222-8222-222222222222';
  SELECT current_platform_balance,profit_balance
    INTO v_parent_balance,v_parent_profit
    FROM public.users WHERE id='66666666-6666-4666-8666-666666666666';
  SELECT current_platform_balance,profit_balance
    INTO v_grandparent_balance,v_grandparent_profit
    FROM public.users WHERE id='77777777-7777-4777-8777-777777777777';
  SELECT count(*) INTO v_referral_entries
    FROM public.account_ledger WHERE entry_type IN ('REFERRAL_L1','REFERRAL_L2');
  IF v_balance <> 100 OR v_principal <> 100 OR v_user_deposits <> 1
     OR v_parent_balance <> 3.50 OR v_parent_profit <> 3.50
     OR v_grandparent_balance <> 1.25 OR v_grandparent_profit <> 1.25
     OR v_referral_entries <> 2 THEN
    RAISE EXCEPTION 'Repeated verified deposit changed balances or duplicated ledger/referral entries';
  END IF;

  -- New submissions persist network, so a case-insensitive duplicate is rejected at INSERT.
  v_failed := false;
  BEGIN
    INSERT INTO public.deposit_submissions(
      id,user_id,tier_id,gross_amount,deposit_fee,credited_amount,status,ai_review_status,txid,network
    ) VALUES (
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
      'tier-a',100.00,0.00,100.00,'PENDING_VERIFICATION','APPROVED',
      upper('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'),
      'tron mainnet'
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Duplicate network/transaction ID was not rejected at submission'; END IF;

  -- A legacy row lacking the network is still rejected when credit tries to bind it to the chain.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,credited_amount,status,ai_review_status,txid
  ) VALUES (
    '33333333-3333-4333-8333-333333333334',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',100.00,0.00,100.00,'PENDING_VERIFICATION','APPROVED',
    upper('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789')
  );
  v_failed := false;
  BEGIN
    PERFORM public.apply_verified_deposit(
      '33333333-3333-4333-8333-333333333334',
      'TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn','100000000',
      '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Deposit with no recorded network was credited'; END IF;
  IF (SELECT status FROM public.deposit_submissions
      WHERE id='33333333-3333-4333-8333-333333333334') <> 'PENDING_VERIFICATION' THEN
    RAISE EXCEPTION 'Rejected duplicate should remain pending for manual reconciliation';
  END IF;

  -- A pending deposit must not be re-bound to a different chain when settings change.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,credited_amount,status,ai_review_status,txid,network
  ) VALUES (
    'abababab-abab-4bab-8bab-abababababab',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',50.00,0.00,50.00,'PENDING_VERIFICATION','APPROVED',
    'fefefe0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    'TRON TESTNET'
  );
  v_failed := false;
  BEGIN
    PERFORM public.apply_verified_deposit(
      'abababab-abab-4bab-8bab-abababababab',
      'TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn','50000000',
      '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Deposit network change was accepted'; END IF;
  IF (SELECT status FROM public.deposit_submissions
      WHERE id='abababab-abab-4bab-8bab-abababababab') <> 'PENDING_VERIFICATION' THEN
    RAISE EXCEPTION 'Deposit network mismatch changed the deposit status'; END IF;

  -- The database boundary must independently reject a raw on-chain amount
  -- that differs from the submitted amount, even if the caller bypasses its pre-check.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,credited_amount,status,ai_review_status,txid,network
  ) VALUES (
    '88888888-8888-4888-8888-888888888888',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',25.00,0.00,25.00,'PENDING_VERIFICATION','APPROVED',
    'eeeeee0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    'TRON MAINNET'
  );
  v_failed := false;
  BEGIN
    PERFORM public.apply_verified_deposit(
      '88888888-8888-4888-8888-888888888888',
      'TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn','10000000',
      '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Raw chain amount mismatch was accepted'; END IF;
  IF (SELECT status FROM public.deposit_submissions
      WHERE id='88888888-8888-4888-8888-888888888888') <> 'PENDING_VERIFICATION' THEN
    RAISE EXCEPTION 'A mismatched raw amount changed the deposit status'; END IF;
  SELECT current_platform_balance,principal_balance
    INTO v_balance,v_principal
    FROM public.users WHERE id='11111111-1111-4111-8111-111111111111';
  SELECT count(*) INTO v_user_deposits FROM public.account_ledger
    WHERE entry_type='USER_DEPOSIT';
  IF v_balance <> 100 OR v_principal <> 100 OR v_user_deposits <> 1 THEN
    RAISE EXCEPTION 'Raw amount mismatch had a partial financial side effect';
  END IF;

  -- A malformed chain transaction ID must not be creditable.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,credited_amount,status,ai_review_status,txid,network
  ) VALUES (
    '99999999-9999-4999-8999-999999999999',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',12.00,0.00,12.00,'PENDING_VERIFICATION','APPROVED',
    'not-a-valid-transaction-hash',
    'TRON MAINNET'
  );
  v_failed := false;
  BEGIN
    PERFORM public.apply_verified_deposit(
      '99999999-9999-4999-8999-999999999999',
      'TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn','12000000',
      '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Malformed chain transaction ID was accepted'; END IF;
  IF (SELECT status FROM public.deposit_submissions
      WHERE id='99999999-9999-4999-8999-999999999999') <> 'PENDING_VERIFICATION' THEN
    RAISE EXCEPTION 'Malformed chain transaction changed the deposit status'; END IF;

  -- Missing/unapproved review must fail without a financial side effect.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,credited_amount,status,ai_review_status,txid,network
  ) VALUES (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',25.00,0.00,25.00,'PENDING_VERIFICATION','PENDING_REVIEW',
    'bbbbbb0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    'TRON MAINNET'
  );
  v_failed := false;
  BEGIN
    PERFORM public.apply_verified_deposit(
      '44444444-4444-4444-8444-444444444444',
      'TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn','25000000',
      '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
    );
  EXCEPTION WHEN raise_exception THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Unapproved deposit evidence was accepted'; END IF;

  -- Payouts enabled must not override the separate disabled live-deposit gate.
  UPDATE public.platform_settings
    SET value_json = value_json || '{"live_deposits":false,"real_payouts":true}'::jsonb
    WHERE key='system_mode';
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,credited_amount,status,ai_review_status,txid,network
  ) VALUES (
    '55555555-5555-4555-8555-555555555555',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',30.00,0.00,30.00,'PENDING_VERIFICATION','APPROVED',
    'cccccc0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    'TRON MAINNET'
  );
  v_failed := false;
  BEGIN
    PERFORM public.apply_verified_deposit(
      '55555555-5555-4555-8555-555555555555',
      'TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn','30000000',
      '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
    );
  EXCEPTION WHEN raise_exception THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Deposit was credited while the live-deposit gate was disabled'; END IF;

  SELECT current_platform_balance,principal_balance
    INTO v_balance,v_principal
    FROM public.users WHERE id='11111111-1111-4111-8111-111111111111';
  SELECT count(*) INTO v_user_deposits FROM public.account_ledger
    WHERE entry_type='USER_DEPOSIT';
  IF v_balance <> 100 OR v_principal <> 100 OR v_user_deposits <> 1 THEN
    RAISE EXCEPTION 'Rejected deposits changed the balance or ledger';
  END IF;

  -- Testnet remains usable even when the Mainnet live-deposit flag is off.
  UPDATE public.platform_settings
    SET value_json = value_json || '{"network":"TRON TESTNET","token_contract":"TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs"}'::jsonb
    WHERE key='deposit_rules';
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,credited_amount,status,ai_review_status,txid,network
  ) VALUES (
    '66666666-6666-4666-8666-666666666666',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',10.00,0.00,10.00,'PENDING_VERIFICATION','APPROVED',
    'dddddd0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    'TRON TESTNET'
  );
  PERFORM public.apply_verified_deposit(
    '66666666-6666-4666-8666-666666666666',
    'TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn','10000000',
    '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
  );
  SELECT current_platform_balance,principal_balance
    INTO v_balance,v_principal
    FROM public.users WHERE id='11111111-1111-4111-8111-111111111111';
  IF v_balance <> 110 OR v_principal <> 110 THEN
    RAISE EXCEPTION 'Testnet deposit should continue to work while Mainnet deposits are paused';
  END IF;

  RAISE NOTICE 'Deposit migration integration assertions passed';
END;
$tests$;
