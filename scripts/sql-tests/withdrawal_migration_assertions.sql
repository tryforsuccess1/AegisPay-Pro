DO $tests$
DECLARE
  v_user uuid := '11111111-1111-4111-8111-111111111111';
  v_admin uuid := '99999999-9999-4999-8999-999999999999';
  v_w public.withdrawal_requests;
  v_balance numeric;
  v_held numeric;
  v_count integer;
  v_ok boolean;
  v_result jsonb;
BEGIN
  PERFORM set_config('aegis.test_actor_id',v_admin::text,true);
  PERFORM set_config('aegis.test_role','MASTER ADMIN',true);

  -- Historical recovery adds one matching negative debit; it does not mutate balances.
  SELECT count(*) INTO v_count FROM public.account_ledger
  WHERE entry_type='WITHDRAWAL_DEBIT'
    AND reference_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND user_id=v_user AND amount=-5.00;
  IF v_count<>1 THEN RAISE EXCEPTION 'Historical debit backfill should create exactly one matching debit'; END IF;
  SELECT current_platform_balance,withdrawal_held INTO v_balance,v_held FROM public.users WHERE id=v_user;
  IF v_balance<>100.00 OR v_held<>60.00 THEN RAISE EXCEPTION 'Historical debit backfill unexpectedly changed user money'; END IF;

  INSERT INTO public.withdrawal_requests(id,user_id,amount,fee_amount,net_amount)
  VALUES('22222222-2222-4222-8222-222222222222',v_user,60,0,60);

  -- Panel approval by itself must not mark the withdrawal paid/approved or debit funds.
  SELECT * INTO v_w FROM public.finalize_withdrawal('22222222-2222-4222-8222-222222222222',true);
  IF v_w.status<>'PENDING_APPROVAL' OR v_w.panel_decision<>'APPROVED'
     OR v_w.balance_deducted IS TRUE OR v_w.telegram_decision<>'PENDING' THEN
    RAISE EXCEPTION 'Panel-only approval must wait for the human Telegram decision';
  END IF;
  SELECT current_platform_balance,withdrawal_held INTO v_balance,v_held FROM public.users WHERE id=v_user;
  SELECT count(*) INTO v_count FROM public.account_ledger
    WHERE entry_type='WITHDRAWAL_DEBIT' AND reference_id='22222222-2222-4222-8222-222222222222';
  IF v_balance<>100 OR v_held<>60 OR v_count<>0 THEN
    RAISE EXCEPTION 'Panel-only approval changed balances or recorded a premature debit';
  END IF;

  -- The human Telegram approval completes the two-key workflow and records exactly one debit.
  SELECT * INTO v_w FROM public.record_withdrawal_telegram_decision(
    '22222222-2222-4222-8222-222222222222',true,'123456'
  );
  IF v_w.status<>'APPROVED' OR v_w.balance_deducted IS NOT TRUE
     OR v_w.panel_decision<>'APPROVED' OR v_w.telegram_decision<>'APPROVED' THEN
    RAISE EXCEPTION 'Both explicit approvals should finalize the withdrawal';
  END IF;
  SELECT current_platform_balance,withdrawal_held INTO v_balance,v_held FROM public.users WHERE id=v_user;
  SELECT count(*) INTO v_count FROM public.account_ledger
    WHERE entry_type='WITHDRAWAL_DEBIT'
      AND reference_id='22222222-2222-4222-8222-222222222222'
      AND user_id=v_user AND amount=-60.00;
  IF v_balance<>40 OR v_held<>0 OR v_count<>1 THEN
    RAISE EXCEPTION 'Two approvals must atomically debit balance/hold and record one negative ledger entry';
  END IF;

  -- A replayed Telegram callback cannot repeat the debit or mutate balance.
  v_ok:=false;
  BEGIN
    PERFORM public.record_withdrawal_telegram_decision(
      '22222222-2222-4222-8222-222222222222',true,'123456'
    );
  EXCEPTION WHEN raise_exception THEN v_ok:=true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'Repeated Telegram decision should fail closed'; END IF;
  SELECT count(*) INTO v_count FROM public.account_ledger
    WHERE entry_type='WITHDRAWAL_DEBIT'
      AND reference_id='22222222-2222-4222-8222-222222222222';
  SELECT current_platform_balance INTO v_balance FROM public.users WHERE id=v_user;
  IF v_count<>1 OR v_balance<>40 THEN RAISE EXCEPTION 'Repeated callback duplicated the debit or changed balance'; END IF;

  -- Telegram rejection releases the reservation but does not debit or alter balance.
  UPDATE public.users SET withdrawal_held=10 WHERE id=v_user;
  INSERT INTO public.withdrawal_requests(id,user_id,amount,fee_amount,net_amount)
  VALUES('33333333-3333-4333-8333-333333333333',v_user,10,0,10);
  SELECT * INTO v_w FROM public.record_withdrawal_telegram_decision(
    '33333333-3333-4333-8333-333333333333',false,'123456'
  );
  SELECT current_platform_balance,withdrawal_held INTO v_balance,v_held FROM public.users WHERE id=v_user;
  IF v_w.status<>'REJECTED' OR v_balance<>40 OR v_held<>0 THEN
    RAISE EXCEPTION 'Telegram rejection should release hold without touching the balance';
  END IF;

  -- Panel rejection also releases a reservation and creates no debit.
  UPDATE public.users SET withdrawal_held=5 WHERE id=v_user;
  INSERT INTO public.withdrawal_requests(id,user_id,amount,fee_amount,net_amount)
  VALUES('44444444-4444-4444-8444-444444444444',v_user,5,0,5);
  SELECT * INTO v_w FROM public.finalize_withdrawal('44444444-4444-4444-8444-444444444444',false);
  SELECT current_platform_balance,withdrawal_held INTO v_balance,v_held FROM public.users WHERE id=v_user;
  IF v_w.status<>'REJECTED' OR v_balance<>40 OR v_held<>0 THEN
    RAISE EXCEPTION 'Panel rejection should release hold without touching the balance';
  END IF;

  -- Insufficient current balance after an early Telegram approval must not partially approve.
  UPDATE public.users SET withdrawal_held=50 WHERE id=v_user;
  INSERT INTO public.withdrawal_requests(id,user_id,amount,fee_amount,net_amount)
  VALUES('55555555-5555-4555-8555-555555555555',v_user,50,0,50);
  PERFORM public.record_withdrawal_telegram_decision(
    '55555555-5555-4555-8555-555555555555',true,'123456'
  );
  v_ok:=false;
  BEGIN
    PERFORM public.finalize_withdrawal('55555555-5555-4555-8555-555555555555',true);
  EXCEPTION WHEN raise_exception THEN v_ok:=true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'Approval with an insufficient balance must fail closed'; END IF;
  SELECT current_platform_balance,withdrawal_held INTO v_balance,v_held FROM public.users WHERE id=v_user;
  SELECT count(*) INTO v_count FROM public.account_ledger
    WHERE entry_type='WITHDRAWAL_DEBIT' AND reference_id='55555555-5555-4555-8555-555555555555';
  IF v_balance<>40 OR v_held<>50 OR v_count<>0 THEN
    RAISE EXCEPTION 'Failed financial approval caused a partial balance/ledger mutation';
  END IF;
  UPDATE public.users SET withdrawal_held=0 WHERE id=v_user;

  -- If a debit reference already exists, approval refuses it even if the balance flag is false.
  UPDATE public.users SET withdrawal_held=5 WHERE id=v_user;
  INSERT INTO public.withdrawal_requests(id,user_id,amount,fee_amount,net_amount)
  VALUES('66666666-6666-4666-8666-666666666666',v_user,5,0,5);
  INSERT INTO public.account_ledger(user_id,entry_type,amount,description,reference_id)
  VALUES(v_user,'WITHDRAWAL_DEBIT',-5,'Synthetic conflicting debit for guard test',
    '66666666-6666-4666-8666-666666666666');
  v_ok:=false;
  BEGIN
    PERFORM public.finalize_withdrawal('66666666-6666-4666-8666-666666666666',true);
  EXCEPTION WHEN raise_exception THEN v_ok:=true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'Approval must reject a pre-existing debit reference'; END IF;
  SELECT panel_decision,status INTO v_w.panel_decision,v_w.status
    FROM public.withdrawal_requests WHERE id='66666666-6666-4666-8666-666666666666';
  SELECT current_platform_balance INTO v_balance FROM public.users WHERE id=v_user;
  IF v_w.panel_decision<>'PENDING' OR v_w.status<>'PENDING_APPROVAL' OR v_balance<>40 THEN
    RAISE EXCEPTION 'Conflicting debit guard allowed a partial approval';
  END IF;
  UPDATE public.users SET withdrawal_held=0 WHERE id=v_user;

  -- The AI RPC may score/review a request but can never approve, debit, or bypass Telegram.
  UPDATE public.users SET withdrawal_held=10 WHERE id=v_user;
  INSERT INTO public.withdrawal_requests(id,user_id,amount,fee_amount,net_amount)
  VALUES('77777777-7777-4777-8777-777777777777',v_user,10,0,10);
  v_result:=public.auto_approve_withdrawal(
    '77777777-7777-4777-8777-777777777777',0.999,'synthetic high confidence'
  );
  SELECT status INTO v_w.status FROM public.withdrawal_requests
    WHERE id='77777777-7777-4777-8777-777777777777';
  SELECT current_platform_balance,withdrawal_held INTO v_balance,v_held FROM public.users WHERE id=v_user;
  SELECT count(*) INTO v_count FROM public.account_ledger
    WHERE entry_type='WITHDRAWAL_DEBIT' AND reference_id='77777777-7777-4777-8777-777777777777';
  IF v_result->>'decision'<>'MANUAL_REVIEW'
     OR v_result->>'reason'<>'TELEGRAM_HUMAN_APPROVAL_REQUIRED'
     OR v_w.status<>'PENDING_APPROVAL' OR v_balance<>40 OR v_held<>10 OR v_count<>0 THEN
    RAISE EXCEPTION 'AI withdrawal review must never auto-approve or move money';
  END IF;

  RAISE NOTICE 'Withdrawal approval/ledger integration assertions passed';
END;
$tests$;
