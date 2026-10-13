-- Behavior tests for the deposit-credit migration using a disposable PostgreSQL schema.
DO $tests$
DECLARE
  v_balance numeric;
  v_principal numeric;
  v_user_deposits integer;
  v_failed boolean;
BEGIN
  -- Mainnet credit must succeed when deposits are enabled even while payouts are disabled.
  PERFORM public.apply_verified_deposit(
    '22222222-2222-4222-8222-222222222222',
    'TTestSenderAddress',
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

  -- Repeating the same verified request must have no second financial effect.
  PERFORM public.apply_verified_deposit(
    '22222222-2222-4222-8222-222222222222',
    'TTestSenderAddress','100000000',
    '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
  );
  SELECT current_platform_balance,principal_balance
    INTO v_balance,v_principal
    FROM public.users WHERE id='11111111-1111-4111-8111-111111111111';
  SELECT count(*) INTO v_user_deposits FROM public.account_ledger
    WHERE entry_type='USER_DEPOSIT'
      AND reference_id='22222222-2222-4222-8222-222222222222';
  IF v_balance <> 100 OR v_principal <> 100 OR v_user_deposits <> 1 THEN
    RAISE EXCEPTION 'Repeated verified deposit changed the balance or duplicated the ledger';
  END IF;

  -- Same transaction ID with different letter casing must not be credited twice.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,status,ai_review_status,txid
  ) VALUES (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',100.00,0.00,'PENDING_VERIFICATION','APPROVED',
    upper('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789')
  );
  v_failed := false;
  BEGIN
    PERFORM public.apply_verified_deposit(
      '33333333-3333-4333-8333-333333333333',
      'TTestSenderAddress','100000000',
      '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Duplicate network/transaction ID was not rejected'; END IF;
  IF (SELECT status FROM public.deposit_submissions
      WHERE id='33333333-3333-4333-8333-333333333333') <> 'PENDING_VERIFICATION' THEN
    RAISE EXCEPTION 'Rejected duplicate should remain pending for manual reconciliation';
  END IF;
  SELECT current_platform_balance,principal_balance
    INTO v_balance,v_principal
    FROM public.users WHERE id='11111111-1111-4111-8111-111111111111';
  SELECT count(*) INTO v_user_deposits FROM public.account_ledger
    WHERE entry_type='USER_DEPOSIT';
  IF v_balance <> 100 OR v_principal <> 100 OR v_user_deposits <> 1 THEN
    RAISE EXCEPTION 'Duplicate transaction attempt had a partial financial side effect';
  END IF;

  -- Missing/unapproved review must fail without a financial side effect.
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,status,ai_review_status,txid
  ) VALUES (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',25.00,0.00,'PENDING_VERIFICATION','PENDING_REVIEW',
    'bbbbbb0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
  );
  v_failed := false;
  BEGIN
    PERFORM public.apply_verified_deposit(
      '44444444-4444-4444-8444-444444444444',
      'TTestSenderAddress','25000000',
      '2026-10-13T00:00:00Z'::timestamptz,'TronGrid'
    );
  EXCEPTION WHEN raise_exception THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Unapproved deposit evidence was accepted'; END IF;

  -- Payouts enabled must never override the separate disabled live-deposit gate.
  UPDATE public.platform_settings
    SET value_json = value_json || '{"live_deposits":false,"real_payouts":true}'::jsonb
    WHERE key='system_mode';
  INSERT INTO public.deposit_submissions(
    id,user_id,tier_id,gross_amount,deposit_fee,status,ai_review_status,txid
  ) VALUES (
    '55555555-5555-4555-8555-555555555555',
    '11111111-1111-4111-8111-111111111111',
    'tier-a',30.00,0.00,'PENDING_VERIFICATION','APPROVED',
    'cccccc0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
  );
  v_failed := false;
  BEGIN
    PERFORM public.apply_verified_deposit(
      '55555555-5555-4555-8555-555555555555',
      'TTestSenderAddress','30000000',
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

  RAISE NOTICE 'Deposit migration integration assertions passed';
END;
$tests$;
