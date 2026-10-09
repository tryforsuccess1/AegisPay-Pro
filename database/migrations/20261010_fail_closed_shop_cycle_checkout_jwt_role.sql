CREATE OR REPLACE FUNCTION public.complete_shop_cycle_checkout(p_user_id uuid, p_cycle_id uuid, p_task_ids uuid[])
 RETURNS cycle_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  c public.cycle_runs;
  v_profile public.users;
  v_requested uuid[];
  v_assigned uuid[];
  v_total numeric := 0;
  v_new_balance numeric;
  v_count integer := 0;
  v_jwt_role text := COALESCE(
    auth.jwt() ->> 'role',
    NULLIF(current_setting('request.jwt.claim.role', true), '')
  );
BEGIN
  IF p_user_id IS NULL OR p_cycle_id IS NULL OR p_task_ids IS NULL OR cardinality(p_task_ids)=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A valid user, cycle and complete task set are required';
  END IF;

  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated','service_role') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authorized service access is required';
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF public.current_app_user_id() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Client access is restricted to the signed-in account';
    END IF;
  END IF;

  SELECT * INTO v_profile
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'AegisPay profile not found'; END IF;
  IF v_profile.role <> 'USER' THEN RAISE EXCEPTION 'Active client access is required'; END IF;
  IF upper(coalesce(v_profile.status,'')) NOT IN ('ACTIVE','NORMAL') THEN
    RAISE EXCEPTION 'This account is not active';
  END IF;
  IF v_profile.frozen_until IS NOT NULL AND v_profile.frozen_until > now() THEN
    RAISE EXCEPTION 'Account is temporarily frozen for security';
  END IF;
  IF NOT public.app_runtime_enabled() THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='AegisPay is paused by Master Admin';
  END IF;

  SELECT * INTO c
  FROM public.cycle_runs
  WHERE id = p_cycle_id AND user_id = p_user_id
  FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Shop cycle not found'; END IF;
  IF c.status = 'WAITING_18H' THEN RETURN c; END IF;
  IF c.status <> 'TASKS_OPEN' THEN RAISE EXCEPTION 'This Shop cycle is not accepting checkout'; END IF;

  SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]),
         count(*),
         coalesce(sum(task_value),0)
  INTO v_assigned,v_count,v_total
  FROM public.tasks
  WHERE cycle_id = c.id AND user_id = p_user_id;

  IF v_count = 0 THEN RAISE EXCEPTION 'This Shop cycle has no assigned tasks'; END IF;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}'::uuid[])
  INTO v_requested FROM unnest(p_task_ids) AS x;
  IF v_requested <> v_assigned THEN
    RAISE EXCEPTION 'Checkout must include every assigned Shop task exactly once';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE cycle_id=c.id AND user_id=p_user_id AND status='Completed'
  ) THEN RAISE EXCEPTION 'This cycle contains a partially completed task set'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE cycle_id=c.id AND user_id=p_user_id AND shop_purchase_confirmed<>true
  ) THEN RAISE EXCEPTION 'Every assigned Shop purchase must be confirmed before cycle checkout'; END IF;
  IF abs(v_total-coalesce(c.cycle_base,0)) > 0.01 THEN
    RAISE EXCEPTION 'Assigned Shop task values do not equal the full cycle balance';
  END IF;

  IF v_total > 0 THEN
    IF v_profile.current_platform_balance-coalesce(v_profile.withdrawal_held,0) < v_total THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Insufficient available USDT balance for this Shop cycle';
    END IF;
    UPDATE public.users
    SET current_platform_balance=current_platform_balance-v_total
    WHERE id=p_user_id
    RETURNING current_platform_balance INTO v_new_balance;

    INSERT INTO public.account_ledger(
      user_id,entry_type,amount,description,actor_user_id,reference_id,metadata
    )
    SELECT p_user_id,'SHOP_TASK_DEBIT',-coalesce(t.task_value,0),
      'Shop task purchase debit: '||coalesce(t.title,'Assigned Shop Task'),
      p_user_id,t.id::text,
      jsonb_build_object(
        'task_id',t.id,'cycle_id',c.id,'task_value',coalesce(t.task_value,0),
        'cycle_checkout',true,'balance_after_cycle',v_new_balance,
        'purchase_reference',t.shop_purchase_reference,
        'purchase_confirmed_at',t.shop_purchase_confirmed_at
      )
    FROM public.tasks t
    WHERE t.cycle_id=c.id AND t.user_id=p_user_id;
  END IF;

  UPDATE public.tasks
  SET status='Completed',progress=100,completion_date=current_date
  WHERE cycle_id=c.id AND user_id=p_user_id AND status IN ('Pending','In Progress');

  UPDATE public.cycle_runs
  SET status='WAITING_18H',task_completed_at=now(),ready_at=now()+interval '18 hours'
  WHERE id=c.id AND user_id=p_user_id AND status='TASKS_OPEN'
  RETURNING * INTO c;

  IF c.id IS NULL THEN RAISE EXCEPTION 'Shop cycle could not be advanced'; END IF;
  RETURN c;
END;
$function$
