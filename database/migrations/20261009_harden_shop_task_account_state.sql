-- Enforce account/runtime state at the server boundary for Shop purchase confirmation and task completion.
-- These checks intentionally preserve the current balance/settlement logic and RPC signatures.

CREATE OR REPLACE FUNCTION public.record_shop_task_purchase(p_task_id uuid, p_product_id text)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid;
  v_profile public.users;
  v_task public.tasks;
  v_cycle public.cycle_runs;
  v_expected_product text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication is required';
  END IF;

  v_user_id := public.current_app_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AegisPay profile not found';
  END IF;

  SELECT * INTO v_profile
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;

  IF v_profile.id IS NULL OR v_profile.role <> 'USER' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active client access is required';
  END IF;
  IF upper(COALESCE(v_profile.status,'')) NOT IN ('ACTIVE','NORMAL') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='This account is not active';
  END IF;
  IF v_profile.frozen_until IS NOT NULL AND v_profile.frozen_until > now() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Account is temporarily frozen for security';
  END IF;
  IF NOT public.app_runtime_enabled() THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='AegisPay is paused by Master Admin';
  END IF;

  IF p_task_id IS NULL OR nullif(trim(coalesce(p_product_id,'')),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A valid Shop task and product are required';
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id AND user_id = v_user_id
  FOR UPDATE;
  IF v_task.id IS NULL THEN RAISE EXCEPTION 'Shop task not found'; END IF;
  IF v_task.status = 'Completed' THEN RAISE EXCEPTION 'This Shop task is already completed'; END IF;

  SELECT * INTO v_cycle
  FROM public.cycle_runs
  WHERE id = v_task.cycle_id AND user_id = v_user_id
  FOR UPDATE;
  IF v_cycle.id IS NULL THEN RAISE EXCEPTION 'Shop cycle not found'; END IF;
  IF v_cycle.status <> 'TASKS_OPEN' THEN
    RAISE EXCEPTION 'This Shop cycle is no longer accepting tasks';
  END IF;

  SELECT so.product_id INTO v_expected_product
  FROM public.shop_offers so
  WHERE so.id::text = v_task.offer_id
  LIMIT 1;

  IF v_expected_product IS NOT NULL AND v_expected_product <> trim(p_product_id) THEN
    RAISE EXCEPTION 'The selected Shop product does not match the assigned task';
  END IF;

  UPDATE public.tasks
  SET shop_purchase_confirmed = true,
      shop_purchase_confirmed_at = coalesce(shop_purchase_confirmed_at, now()),
      shop_purchase_product_id = trim(p_product_id),
      shop_purchase_reference = coalesce(
        shop_purchase_reference,
        'AP-SHOP-' || upper(substr(replace(v_task.id::text,'-',''),1,20))
      )
  WHERE id = v_task.id AND user_id = v_user_id
  RETURNING * INTO v_task;

  RETURN v_task;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_shop_task(p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid;
  v_profile public.users;
  t public.tasks;
  c public.cycle_runs;
  pending_count integer;
  v_charge numeric := 0;
  v_new_balance numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication is required';
  END IF;

  v_user_id := public.current_app_user_id();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AegisPay profile not found'; END IF;

  SELECT * INTO v_profile
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;

  IF v_profile.id IS NULL OR v_profile.role <> 'USER' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active client access is required';
  END IF;
  IF upper(COALESCE(v_profile.status,'')) NOT IN ('ACTIVE','NORMAL') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='This account is not active';
  END IF;
  IF v_profile.frozen_until IS NOT NULL AND v_profile.frozen_until > now() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Account is temporarily frozen for security';
  END IF;
  IF NOT public.app_runtime_enabled() THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='AegisPay is paused by Master Admin';
  END IF;

  SELECT * INTO t
  FROM public.tasks
  WHERE id = p_task_id AND user_id = v_user_id
  FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Shop task not found'; END IF;
  IF t.status = 'Completed' THEN RETURN t; END IF;

  IF t.shop_purchase_confirmed <> true THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Confirm the assigned Shop purchase before completing this task';
  END IF;

  SELECT * INTO c
  FROM public.cycle_runs
  WHERE id = t.cycle_id AND user_id = v_user_id
  FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Shop cycle not found'; END IF;
  IF c.status <> 'TASKS_OPEN' THEN
    RAISE EXCEPTION 'This Shop cycle is no longer accepting tasks';
  END IF;

  v_charge := greatest(coalesce(t.task_value,0),0);
  IF v_charge > 0 THEN
    UPDATE public.users
    SET current_platform_balance = current_platform_balance - v_charge
    WHERE id = v_user_id
      AND current_platform_balance - coalesce(withdrawal_held,0) >= v_charge
    RETURNING current_platform_balance INTO v_new_balance;

    IF v_new_balance IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Insufficient available USDT balance for this task';
    END IF;

    INSERT INTO public.account_ledger(
      user_id,entry_type,amount,description,actor_user_id,reference_id,metadata
    )
    VALUES(
      v_user_id,'SHOP_TASK_DEBIT',-v_charge,
      'Shop task purchase debit: ' || coalesce(t.title,'Assigned Shop Task'),
      v_user_id,t.id::text,
      jsonb_build_object(
        'task_id',t.id,
        'cycle_id',t.cycle_id,
        'task_value',v_charge,
        'balance_after',v_new_balance,
        'purchase_reference',t.shop_purchase_reference,
        'purchase_confirmed_at',t.shop_purchase_confirmed_at
      )
    );
  END IF;

  UPDATE public.tasks
  SET status='Completed', progress=100, completion_date=current_date
  WHERE id=t.id AND user_id=v_user_id AND status <> 'Completed'
  RETURNING * INTO t;

  SELECT count(*) INTO pending_count
  FROM public.tasks
  WHERE cycle_id=c.id AND user_id=v_user_id AND status <> 'Completed';

  IF pending_count = 0 THEN
    UPDATE public.cycle_runs
    SET status='WAITING_18H',
        task_completed_at=now(),
        ready_at=now()+interval '18 hours'
    WHERE id=c.id AND user_id=v_user_id AND status='TASKS_OPEN';

    INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
    VALUES
      (v_user_id,'SHOP_TASKS_COMPLETED','All Shop tasks completed',
       'You completed every assigned Shop task. The 18-hour settlement timer has started.',false),
      (v_user_id,'CYCLE_WAITING','18-hour settlement started',
       'Your Shop cycle is now waiting for settlement. No further task action is required.',false);
  END IF;

  RETURN t;
END;
$function$;
