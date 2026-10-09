-- Deduct each Shop task purchase value from the user's available USDT balance.
-- The mutation is atomic with task completion and is recorded in account_ledger.

CREATE OR REPLACE FUNCTION public.complete_shop_task(p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid;
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

  SELECT * INTO t FROM public.tasks
  WHERE id=p_task_id AND user_id=v_user_id FOR UPDATE;

  IF t.id IS NULL THEN RAISE EXCEPTION 'Shop task not found'; END IF;
  IF t.status='Completed' THEN RETURN t; END IF;

  SELECT * INTO c FROM public.cycle_runs
  WHERE id=t.cycle_id AND user_id=v_user_id FOR UPDATE;

  IF c.id IS NULL THEN RAISE EXCEPTION 'Shop cycle not found'; END IF;
  IF c.status<>'TASKS_OPEN' THEN RAISE EXCEPTION 'This Shop cycle is no longer accepting tasks'; END IF;

  v_charge := greatest(coalesce(t.task_value,0),0);

  IF v_charge > 0 THEN
    UPDATE public.users
       SET current_platform_balance = current_platform_balance - v_charge
     WHERE id=v_user_id
       AND current_platform_balance - coalesce(withdrawal_held,0) >= v_charge
     RETURNING current_platform_balance INTO v_new_balance;

    IF v_new_balance IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Insufficient available USDT balance for this task';
    END IF;

    INSERT INTO public.account_ledger
      (user_id,entry_type,amount,description,actor_user_id,reference_id,metadata)
    VALUES
      (v_user_id,'SHOP_TASK_DEBIT',-v_charge,
       'Shop task purchase debit: '||coalesce(t.title,'Assigned Shop Task'),
       v_user_id,t.id::text,
       jsonb_build_object('task_id',t.id,'cycle_id',t.cycle_id,'task_value',v_charge,'balance_after',v_new_balance));
  END IF;

  UPDATE public.tasks
     SET status='Completed',progress=100,completion_date=current_date
   WHERE id=t.id AND user_id=v_user_id AND status<>'Completed'
   RETURNING * INTO t;

  SELECT count(*) INTO pending_count
  FROM public.tasks
  WHERE cycle_id=c.id AND user_id=v_user_id AND status<>'Completed';

  IF pending_count=0 THEN
    UPDATE public.cycle_runs
       SET status='WAITING_18H',task_completed_at=now(),ready_at=now()+interval '18 hours'
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

CREATE OR REPLACE FUNCTION public.complete_shop_cycle_checkout(
  p_user_id uuid,p_cycle_id uuid,p_task_ids uuid[]
)
RETURNS public.cycle_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  c public.cycle_runs;
  v_profile public.users;
  v_requested uuid[];
  v_assigned uuid[];
  v_total numeric := 0;
  v_new_balance numeric;
  v_count integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_cycle_id IS NULL OR p_task_ids IS NULL OR cardinality(p_task_ids)=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='A valid user, cycle and complete task set are required';
  END IF;

  IF current_user='authenticated' THEN
    IF public.current_app_user_id() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Client access is restricted to the signed-in account';
    END IF;
  ELSIF current_user<>'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authorized service access is required';
  END IF;

  SELECT * INTO v_profile FROM public.users WHERE id=p_user_id FOR UPDATE;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'AegisPay profile not found'; END IF;
  IF v_profile.role<>'USER' THEN RAISE EXCEPTION 'Active client access is required'; END IF;
  IF upper(coalesce(v_profile.status,'')) NOT IN ('ACTIVE','NORMAL') THEN RAISE EXCEPTION 'This account is not active'; END IF;
  IF v_profile.frozen_until IS NOT NULL AND v_profile.frozen_until>now() THEN RAISE EXCEPTION 'Account is temporarily frozen for security'; END IF;

  SELECT * INTO c FROM public.cycle_runs
  WHERE id=p_cycle_id AND user_id=p_user_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Shop cycle not found'; END IF;
  IF c.status='WAITING_18H' THEN RETURN c; END IF;
  IF c.status<>'TASKS_OPEN' THEN RAISE EXCEPTION 'This Shop cycle is not accepting checkout'; END IF;

  SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]),count(*),coalesce(sum(task_value),0)
    INTO v_assigned,v_count,v_total
  FROM public.tasks WHERE cycle_id=c.id AND user_id=p_user_id;

  IF v_count=0 THEN RAISE EXCEPTION 'This Shop cycle has no assigned tasks'; END IF;

  SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}'::uuid[])
    INTO v_requested FROM unnest(p_task_ids) AS x;

  IF v_requested<>v_assigned THEN RAISE EXCEPTION 'Checkout must include every assigned Shop task exactly once'; END IF;

  IF EXISTS (SELECT 1 FROM public.tasks WHERE cycle_id=c.id AND user_id=p_user_id AND status='Completed') THEN
    RAISE EXCEPTION 'This cycle contains a partially completed task set';
  END IF;

  IF abs(v_total-coalesce(c.cycle_base,0))>0.01 THEN
    RAISE EXCEPTION 'Assigned Shop task values do not equal the full cycle balance';
  END IF;

  IF v_total>0 THEN
    IF v_profile.current_platform_balance-coalesce(v_profile.withdrawal_held,0)<v_total THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Insufficient available USDT balance for this Shop cycle';
    END IF;

    UPDATE public.users SET current_platform_balance=current_platform_balance-v_total
    WHERE id=p_user_id
    RETURNING current_platform_balance INTO v_new_balance;

    INSERT INTO public.account_ledger
      (user_id,entry_type,amount,description,actor_user_id,reference_id,metadata)
    SELECT p_user_id,'SHOP_TASK_DEBIT',-coalesce(t.task_value,0),
      'Shop task purchase debit: '||coalesce(t.title,'Assigned Shop Task'),
      p_user_id,t.id::text,
      jsonb_build_object('task_id',t.id,'cycle_id',c.id,'task_value',coalesce(t.task_value,0),
                         'cycle_checkout',true,'balance_after_cycle',v_new_balance)
    FROM public.tasks t
    WHERE t.cycle_id=c.id AND t.user_id=p_user_id;
  END IF;

  UPDATE public.tasks SET status='Completed',progress=100,completion_date=current_date
  WHERE cycle_id=c.id AND user_id=p_user_id AND status IN ('Pending','In Progress');

  UPDATE public.cycle_runs
     SET status='WAITING_18H',task_completed_at=now(),ready_at=now()+interval '18 hours'
   WHERE id=c.id AND user_id=p_user_id AND status='TASKS_OPEN'
   RETURNING * INTO c;

  IF c.id IS NULL THEN RAISE EXCEPTION 'Shop cycle could not be advanced'; END IF;

  RETURN c;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_shop_cycle_checkout(uuid,uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_shop_cycle_checkout(uuid,uuid,uuid[]) TO authenticated, service_role;
