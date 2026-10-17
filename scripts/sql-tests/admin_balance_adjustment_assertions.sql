-- Regression tests run only against the disposable PostgreSQL service.
DO $tests$
DECLARE
  v_user uuid := '11111111-1111-4111-8111-111111111111';
  v_admin uuid := '99999999-9999-4999-8999-999999999999';
  v_balance numeric;
  v_manual numeric;
  v_held numeric;
  v_adjustments integer;
  v_ledger integer;
  v_rejected boolean;
BEGIN
  PERFORM set_config('aegis.test_actor_id',v_admin::text,true);
  PERFORM set_config('aegis.test_role','MASTER ADMIN',true);

  -- Valid credit must update both balances and produce one matching ledger pair.
  IF public.master_admin_adjust_balance(v_user,20,'CREDIT','test credit') <> 120 THEN
    RAISE EXCEPTION 'Credit returned an incorrect balance';
  END IF;
  SELECT current_platform_balance,manual_credit_balance,withdrawal_held
    INTO v_balance,v_manual,v_held FROM public.users WHERE id=v_user;
  IF v_balance<>120 OR v_manual<>45 OR v_held<>70 THEN
    RAISE EXCEPTION 'Credit did not update the expected account fields';
  END IF;

  -- Valid reversal removes only manual credit, while leaving held funds reserved.
  IF public.master_admin_adjust_balance(v_user,15,'REVERSAL','test reversal') <> 105 THEN
    RAISE EXCEPTION 'Reversal returned an incorrect balance';
  END IF;
  SELECT current_platform_balance,manual_credit_balance,withdrawal_held
    INTO v_balance,v_manual,v_held FROM public.users WHERE id=v_user;
  IF v_balance<>105 OR v_manual<>30 OR v_held<>70 THEN
    RAISE EXCEPTION 'Valid reversal changed the wrong amount';
  END IF;

  SELECT count(*) INTO v_adjustments FROM public.admin_adjustments;
  SELECT count(*) INTO v_ledger FROM public.account_ledger;

  -- Over-reversal must fail without a balance or ledger mutation.
  v_rejected:=false;
  BEGIN
    PERFORM public.master_admin_adjust_balance(v_user,31,'REVERSAL','too much');
  EXCEPTION WHEN OTHERS THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Reversal larger than manual credit must fail'; END IF;

  -- Even a valid amount of manual credit cannot spend funds held for withdrawal.
  UPDATE public.users SET withdrawal_held=100 WHERE id=v_user;
  v_rejected:=false;
  BEGIN
    PERFORM public.master_admin_adjust_balance(v_user,6,'REVERSAL','spend held funds');
  EXCEPTION WHEN OTHERS THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Reversal must not consume withdrawal-held balance'; END IF;
  UPDATE public.users SET withdrawal_held=70 WHERE id=v_user;

  -- Null and non-finite amount/type inputs must fail closed.
  v_rejected:=false;
  BEGIN
    PERFORM public.master_admin_adjust_balance(v_user,'NaN'::numeric,'CREDIT','not finite');
  EXCEPTION WHEN OTHERS THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'NaN amount must fail'; END IF;
  v_rejected:=false;
  BEGIN
    PERFORM public.master_admin_adjust_balance(v_user,1,NULL,'null type');
  EXCEPTION WHEN OTHERS THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Null adjustment type must fail'; END IF;

  -- Only an active Master Admin may invoke the operation.
  PERFORM set_config('aegis.test_actor_id',v_user::text,true);
  PERFORM set_config('aegis.test_role','USER',true);
  v_rejected:=false;
  BEGIN
    PERFORM public.master_admin_adjust_balance(v_user,1,'CREDIT','unauthorized');
  EXCEPTION WHEN OTHERS THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Non-admin balance adjustment must fail'; END IF;

  -- All rejected attempts above must be atomic: no extra ledger or adjustment rows.
  SELECT count(*) INTO v_adjustments FROM public.admin_adjustments;
  SELECT count(*) INTO v_ledger FROM public.account_ledger;
  IF v_adjustments<>2 OR v_ledger<>2 THEN
    RAISE EXCEPTION 'Rejected adjustment created unexpected ledger/adjustment entries';
  END IF;
  SELECT current_platform_balance,manual_credit_balance,withdrawal_held
    INTO v_balance,v_manual,v_held FROM public.users WHERE id=v_user;
  IF v_balance<>105 OR v_manual<>30 OR v_held<>70 THEN
    RAISE EXCEPTION 'Rejected adjustment changed account balances';
  END IF;

  RAISE NOTICE 'Manual balance adjustment regression assertions passed';
END;
$tests$;
