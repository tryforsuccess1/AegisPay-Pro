-- AegisPay Shop purchase-confirmation workflow.
-- A task must have a server-recorded purchase confirmation before its task value can be debited.
-- This is a workflow confirmation inside AegisPay; it is not an external merchant payment.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS shop_purchase_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shop_purchase_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shop_purchase_product_id TEXT,
  ADD COLUMN IF NOT EXISTS shop_purchase_reference TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_shop_purchase_reference_uidx
  ON public.tasks(shop_purchase_reference)
  WHERE shop_purchase_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_shop_purchase_confirmed_idx
  ON public.tasks(user_id, cycle_id, shop_purchase_confirmed);

CREATE OR REPLACE FUNCTION public.record_shop_task_purchase(
  p_task_id uuid,
  p_product_id text
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid;
  v_task public.tasks;
  v_cycle public.cycle_runs;
  v_expected_product text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode='42501', message='Authentication is required';
  END IF;

  v_user_id := public.current_app_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AegisPay profile not found';
  END IF;

  IF p_task_id IS NULL OR nullif(trim(coalesce(p_product_id,'')),'') IS NULL THEN
    RAISE EXCEPTION USING errcode='22023', message='A valid Shop task and product are required';
  END IF;

  SELECT *
    INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Shop task not found';
  END IF;

  IF v_task.status = 'Completed' THEN
    RAISE EXCEPTION 'This Shop task is already completed';
  END IF;

  SELECT *
    INTO v_cycle
  FROM public.cycle_runs
  WHERE id = v_task.cycle_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF v_cycle.id IS NULL THEN
    RAISE EXCEPTION 'Shop cycle not found';
  END IF;

  IF v_cycle.status <> 'TASKS_OPEN' THEN
    RAISE EXCEPTION 'This Shop cycle is no longer accepting tasks';
  END IF;

  SELECT so.product_id
    INTO v_expected_product
  FROM public.shop_offers so
  WHERE so.id::text = v_task.offer_id
  LIMIT 1;

  IF v_expected_product IS NOT NULL
     AND v_expected_product <> trim(p_product_id) THEN
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
   WHERE id = v_task.id
     AND user_id = v_user_id
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
declare
  v_user_id uuid;
  t public.tasks;
  c public.cycle_runs;
  pending_count integer;
  v_charge numeric := 0;
  v_new_balance numeric;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='Authentication is required';
  end if;

  v_user_id := public.current_app_user_id();
  if v_user_id is null then
    raise exception 'AegisPay profile not found';
  end if;

  select *
    into t
  from public.tasks
  where id = p_task_id
    and user_id = v_user_id
  for update;

  if t.id is null then raise exception 'Shop task not found'; end if;
  if t.status = 'Completed' then return t; end if;

  if t.shop_purchase_confirmed <> true then
    raise exception using errcode='P0001',
      message='Confirm the assigned Shop purchase before completing this task';
  end if;

  select *
    into c
  from public.cycle_runs
  where id = t.cycle_id
    and user_id = v_user_id
  for update;

  if c.id is null then raise exception 'Shop cycle not found'; end if;
  if c.status <> 'TASKS_OPEN' then
    raise exception 'This Shop cycle is no longer accepting tasks';
  end if;

  v_charge := greatest(coalesce(t.task_value,0),0);

  if v_charge > 0 then
    update public.users
       set current_platform_balance = current_platform_balance - v_charge
     where id = v_user_id
       and current_platform_balance - coalesce(withdrawal_held,0) >= v_charge
     returning current_platform_balance into v_new_balance;

    if v_new_balance is null then
      raise exception using errcode='P0001',
        message='Insufficient available USDT balance for this task';
    end if;

    insert into public.account_ledger
      (user_id, entry_type, amount, description, actor_user_id, reference_id, metadata)
    values
      (
        v_user_id,
        'SHOP_TASK_DEBIT',
        -v_charge,
        'Shop task purchase debit: ' || coalesce(t.title,'Assigned Shop Task'),
        v_user_id,
        t.id::text,
        jsonb_build_object(
          'task_id', t.id,
          'cycle_id', t.cycle_id,
          'task_value', v_charge,
          'balance_after', v_new_balance,
          'purchase_reference', t.shop_purchase_reference,
          'purchase_confirmed_at', t.shop_purchase_confirmed_at
        )
      );
  end if;

  update public.tasks
     set status='Completed',
         progress=100,
         completion_date=current_date
   where id=t.id
     and user_id=v_user_id
     and status<>'Completed'
   returning * into t;

  select count(*)
    into pending_count
  from public.tasks
  where cycle_id=c.id
    and user_id=v_user_id
    and status<>'Completed';

  if pending_count=0 then
    update public.cycle_runs
       set status='WAITING_18H',
           task_completed_at=now(),
           ready_at=now()+interval '18 hours'
     where id=c.id
       and user_id=v_user_id
       and status='TASKS_OPEN';

    insert into public.notifications(user_id,notification_type,title,body,is_read)
    values
      (
        v_user_id,'SHOP_TASKS_COMPLETED','All Shop tasks completed',
        'You completed every assigned Shop task. The 18-hour settlement timer has started.',
        false
      ),
      (
        v_user_id,'CYCLE_WAITING','18-hour settlement started',
        'Your Shop cycle is now waiting for settlement. No further task action is required.',
        false
      );
  end if;

  return t;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_shop_cycle_checkout(
  p_user_id uuid,
  p_cycle_id uuid,
  p_task_ids uuid[]
)
RETURNS public.cycle_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  c public.cycle_runs;
  v_profile public.users;
  v_requested uuid[];
  v_assigned uuid[];
  v_total numeric := 0;
  v_new_balance numeric;
  v_count integer := 0;
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
begin
  if p_user_id is null or p_cycle_id is null or p_task_ids is null or cardinality(p_task_ids)=0 then
    raise exception using errcode='22023',message='A valid user, cycle and complete task set are required';
  end if;

  if v_jwt_role = 'authenticated' then
    if public.current_app_user_id() is distinct from p_user_id then
      raise exception using errcode='42501',message='Client access is restricted to the signed-in account';
    end if;
  elsif v_jwt_role <> 'service_role' then
    raise exception using errcode='42501',message='Authorized service access is required';
  end if;

  select * into v_profile from public.users where id=p_user_id for update;
  if v_profile.id is null then raise exception 'AegisPay profile not found'; end if;
  if v_profile.role<>'USER' then raise exception 'Active client access is required'; end if;
  if upper(coalesce(v_profile.status,'')) not in ('ACTIVE','NORMAL') then raise exception 'This account is not active'; end if;
  if v_profile.frozen_until is not null and v_profile.frozen_until>now() then raise exception 'Account is temporarily frozen for security'; end if;

  select * into c from public.cycle_runs
  where id=p_cycle_id and user_id=p_user_id for update;
  if c.id is null then raise exception 'Shop cycle not found'; end if;
  if c.status='WAITING_18H' then return c; end if;
  if c.status<>'TASKS_OPEN' then raise exception 'This Shop cycle is not accepting checkout'; end if;

  select coalesce(array_agg(id order by id),'{}'::uuid[]),count(*),coalesce(sum(task_value),0)
    into v_assigned,v_count,v_total
  from public.tasks where cycle_id=c.id and user_id=p_user_id;

  if v_count=0 then raise exception 'This Shop cycle has no assigned tasks'; end if;

  select coalesce(array_agg(distinct x order by x),'{}'::uuid[])
    into v_requested from unnest(p_task_ids) as x;

  if v_requested<>v_assigned then raise exception 'Checkout must include every assigned Shop task exactly once'; end if;
  if exists (select 1 from public.tasks where cycle_id=c.id and user_id=p_user_id and status='Completed') then
    raise exception 'This cycle contains a partially completed task set'; 
  end if;
  if exists (select 1 from public.tasks where cycle_id=c.id and user_id=p_user_id and shop_purchase_confirmed<>true) then
    raise exception 'Every assigned Shop purchase must be confirmed before cycle checkout';
  end if;
  if abs(v_total-coalesce(c.cycle_base,0))>0.01 then
    raise exception 'Assigned Shop task values do not equal the full cycle balance';
  end if;

  if v_total>0 then
    if v_profile.current_platform_balance-coalesce(v_profile.withdrawal_held,0)<v_total then
      raise exception using errcode='P0001',message='Insufficient available USDT balance for this Shop cycle';
    end if;

    update public.users set current_platform_balance=current_platform_balance-v_total
    where id=p_user_id
    returning current_platform_balance into v_new_balance;

    insert into public.account_ledger
      (user_id,entry_type,amount,description,actor_user_id,reference_id,metadata)
    select p_user_id,'SHOP_TASK_DEBIT',-coalesce(t.task_value,0),
      'Shop task purchase debit: '||coalesce(t.title,'Assigned Shop Task'),
      p_user_id,t.id::text,
      jsonb_build_object(
        'task_id',t.id,
        'cycle_id',c.id,
        'task_value',coalesce(t.task_value,0),
        'cycle_checkout',true,
        'balance_after_cycle',v_new_balance,
        'purchase_reference',t.shop_purchase_reference,
        'purchase_confirmed_at',t.shop_purchase_confirmed_at
      )
    from public.tasks t
    where t.cycle_id=c.id and t.user_id=p_user_id;
  end if;

  update public.tasks set status='Completed',progress=100,completion_date=current_date
  where cycle_id=c.id and user_id=p_user_id and status in ('Pending','In Progress');

  update public.cycle_runs
     set status='WAITING_18H',task_completed_at=now(),ready_at=now()+interval '18 hours'
   where id=c.id and user_id=p_user_id and status='TASKS_OPEN'
   returning * into c;

  if c.id is null then raise exception 'Shop cycle could not be advanced'; end if;
  return c;
end;
$function$;

REVOKE ALL ON FUNCTION public.record_shop_task_purchase(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_shop_task_purchase(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_shop_task_purchase(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_shop_task(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_shop_task(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_shop_task(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_shop_cycle_checkout(uuid,uuid,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_shop_cycle_checkout(uuid,uuid,uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_shop_cycle_checkout(uuid,uuid,uuid[]) TO authenticated;
