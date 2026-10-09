-- Harden assigned-product matching and honor Master Admin runtime pause for Shop writes.
-- A task must map to a concrete assigned offer product; service and authenticated checkout paths
-- both respect the global runtime pause.

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

  IF nullif(trim(coalesce(v_expected_product,'')),'') IS NULL THEN
    RAISE EXCEPTION 'The assigned Shop task does not have a resolvable product';
  END IF;
  IF v_expected_product <> trim(p_product_id) THEN
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

CREATE OR REPLACE FUNCTION public.complete_shop_cycle_checkout(p_user_id uuid, p_cycle_id uuid, p_task_ids uuid[])
RETURNS public.cycle_runs
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
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF p_user_id IS NULL OR p_cycle_id IS NULL OR p_task_ids IS NULL OR cardinality(p_task_ids)=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A valid user, cycle and complete task set are required';
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF public.current_app_user_id() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Client access is restricted to the signed-in account';
    END IF;
  ELSIF v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authorized service access is required';
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
$function$;
