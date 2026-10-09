-- Align password-reset security freeze with the documented 24-hour operational freeze.
-- The reset endpoint records password_reset_at + frozen_until. Sensitive client operations
-- must honor that freeze, while automated settlement itself remains unaffected.
BEGIN;

CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount NUMERIC)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_balance NUMERIC;
  v_withdrawal_held NUMERIC;
  v_pending NUMERIC;
  v_wallet TEXT;
  v_status TEXT;
  v_frozen_until TIMESTAMPTZ;
  v_request_id UUID;
  v_fee_rate NUMERIC := 0.10;
  v_fee NUMERIC;
  v_net NUMERIC;
  v_risk NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication is required';
  END IF;

  IF NOT public.app_runtime_enabled() THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='AegisPay is paused by Master Admin';
  END IF;

  v_user_id := public.current_app_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AegisPay profile not found';
  END IF;

  SELECT role, current_platform_balance, withdrawal_held, destination_address, status, frozen_until
    INTO v_role, v_balance, v_withdrawal_held, v_wallet, v_status, v_frozen_until
    FROM public.users WHERE id=v_user_id FOR UPDATE;

  IF v_role <> 'USER' THEN
    RAISE EXCEPTION 'Only client accounts may request withdrawals';
  END IF;

  IF upper(COALESCE(v_status,'')) NOT IN ('ACTIVE','NORMAL') THEN
    RAISE EXCEPTION 'This account is not allowed to request withdrawals';
  END IF;

  IF v_frozen_until IS NOT NULL AND v_frozen_until > NOW() THEN
    RAISE EXCEPTION 'Account is temporarily frozen for security until %', to_char(v_frozen_until AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI UTC');
  END IF;

  IF p_amount IS NULL OR p_amount < 50 THEN
    RAISE EXCEPTION 'Minimum withdrawal is $50';
  END IF;

  IF COALESCE(v_wallet,'')='' THEN
    RAISE EXCEPTION 'Link a withdrawal wallet before requesting a withdrawal';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kyc_verifications
    WHERE user_id=v_user_id AND status='VERIFIED'
  ) THEN
    RAISE EXCEPTION 'Complete KYC verification before requesting a withdrawal';
  END IF;

  SELECT COALESCE((value_json ->> 'fee_rate')::NUMERIC,0.10)
    INTO v_fee_rate
    FROM public.platform_settings
    WHERE key='withdrawal_rules';

  v_fee_rate := LEAST(0.25,GREATEST(0,COALESCE(v_fee_rate,0.10)));
  v_fee := round(p_amount*v_fee_rate,2);
  v_net := p_amount-v_fee;
  v_risk := round(least(0.35,greatest(0.02,p_amount/5000)),4);

  SELECT COALESCE(sum(amount),0) INTO v_pending
    FROM public.withdrawal_requests
    WHERE user_id=v_user_id
      AND status IN ('PENDING_APPROVAL','APPROVED','PROCESSING');

  IF p_amount > COALESCE(v_balance,0) - GREATEST(COALESCE(v_withdrawal_held,0),v_pending) THEN
    RAISE EXCEPTION 'Withdrawal exceeds available balance';
  END IF;

  INSERT INTO public.withdrawal_requests(
    user_id, amount, destination_address, ai_risk_score, fee_amount, net_amount
  )
  VALUES(v_user_id,p_amount,v_wallet,v_risk,v_fee,v_net)
  RETURNING id INTO v_request_id;

  UPDATE public.users
    SET withdrawal_held=GREATEST(COALESCE(withdrawal_held,0),v_pending)+p_amount
    WHERE id=v_user_id;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.request_withdrawal(NUMERIC, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(NUMERIC, TEXT, NUMERIC) TO service_role;
REVOKE ALL ON FUNCTION public.request_withdrawal(NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.link_withdrawal_wallet(p_address TEXT, p_owner_name TEXT)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user public.users;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE auth_user_id = auth.uid()
  FOR UPDATE;

  IF v_user.id IS NULL OR v_user.role <> 'USER' THEN
    RAISE EXCEPTION 'Client profile not found';
  END IF;

  IF upper(COALESCE(v_user.status,'')) IN ('BLOCKED','SUSPENDED','DELETED') THEN
    RAISE EXCEPTION 'This account cannot link a withdrawal wallet';
  END IF;

  IF v_user.frozen_until IS NOT NULL AND v_user.frozen_until > NOW() THEN
    RAISE EXCEPTION 'Account is temporarily frozen for security until %', to_char(v_user.frozen_until AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI UTC');
  END IF;

  IF COALESCE(v_user.destination_address,'') <> '' THEN
    RAISE EXCEPTION 'Withdrawal wallet is already linked';
  END IF;

  IF trim(COALESCE(p_address,'')) !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
    RAISE EXCEPTION 'Enter a valid TRON wallet address';
  END IF;

  IF lower(trim(COALESCE(p_owner_name,''))) <> lower(trim(v_user.name)) THEN
    RAISE EXCEPTION 'Wallet owner name must match the profile name';
  END IF;

  UPDATE public.users
    SET destination_address = trim(p_address),
        withdrawal_wallet_owner_name = trim(p_owner_name)
    WHERE id = v_user.id
  RETURNING * INTO v_user;

  RETURN v_user;
END;
$function$;

REVOKE ALL ON FUNCTION public.link_withdrawal_wallet(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_withdrawal_wallet(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.link_withdrawal_wallet(TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_withdrawal_wallet(TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_auto_task_cycle(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  u public.users;
  t public.vip_tiers;
  c public.cycle_runs;
  offer_row RECORD;
  offer_count integer := 0;
  offer_index integer := 0;
  available_balance numeric(18,2);
  task_value numeric(18,2);
  task_reward numeric(18,2);
  remaining_value numeric(18,2);
  remaining_reward numeric(18,2);
  cycle_profit numeric(18,2);
  tier_rate numeric(18,8);
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO u FROM public.users WHERE id = p_user_id FOR UPDATE;

  IF u.id IS NULL
     OR u.role <> 'USER'
     OR upper(COALESCE(u.status,'')) NOT IN ('ACTIVE','NORMAL') THEN
    RETURN NULL;
  END IF;

  IF u.frozen_until IS NOT NULL AND u.frozen_until > NOW() THEN
    RETURN NULL;
  END IF;

  available_balance := ROUND(
    GREATEST(
      0,
      COALESCE(u.current_platform_balance,0)
        - GREATEST(COALESCE(u.withdrawal_held,0),0)
    ),
    2
  );

  IF available_balance <= 0 THEN RETURN NULL; END IF;

  IF EXISTS (
    SELECT 1 FROM public.cycle_runs
    WHERE user_id = u.id AND status IN ('TASKS_OPEN','WAITING_18H')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO t
  FROM public.vip_tiers
  WHERE id = u.selected_tier_id AND enabled = true
  FOR SHARE;

  IF t.id IS NULL THEN
    SELECT vt.* INTO t
    FROM public.cycle_runs cr
    JOIN public.vip_tiers vt ON vt.id = cr.tier_id
    WHERE cr.user_id = u.id
    ORDER BY cr.created_at DESC
    LIMIT 1
    FOR SHARE;
  END IF;

  IF t.id IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*) INTO offer_count
  FROM public.shop_offers so
  JOIN public.vip_tiers vt ON vt.id = so.tier_min_id
  WHERE so.status='ACTIVE'
    AND vt.enabled=true
    AND vt.display_order<=t.display_order
    AND so.product_id IS NOT NULL;

  IF offer_count <= 0 THEN RETURN NULL; END IF;

  tier_rate := CASE WHEN COALESCE(t.deposit_amount,0)>0
    THEN COALESCE(t.initial_profit,0)/t.deposit_amount ELSE 0 END;

  cycle_profit := ROUND(available_balance*tier_rate,2);

  INSERT INTO public.cycle_runs(user_id,tier_id,cycle_base,status,profit_amount,source_deposit_id)
  VALUES(u.id,t.id,available_balance,'TASKS_OPEN',cycle_profit,NULL)
  RETURNING * INTO c;

  remaining_value:=available_balance;
  remaining_reward:=cycle_profit;

  FOR offer_row IN
    SELECT so.id,so.title,so.subtitle,so.task_level,so.instructions,so.product_id,vt.display_order
    FROM public.shop_offers so
    JOIN public.vip_tiers vt ON vt.id=so.tier_min_id
    WHERE so.status='ACTIVE' AND vt.enabled=true
      AND vt.display_order<=t.display_order
      AND so.product_id IS NOT NULL
    ORDER BY vt.display_order,so.created_at,so.id
  LOOP
    offer_index:=offer_index+1;
    IF offer_index=offer_count THEN
      task_value:=ROUND(remaining_value,2);
      task_reward:=ROUND(remaining_reward,2);
    ELSE
      task_value:=ROUND(available_balance/offer_count,2);
      task_reward:=ROUND(cycle_profit/offer_count,2);
      remaining_value:=ROUND(remaining_value-task_value,2);
      remaining_reward:=ROUND(remaining_reward-task_reward,2);
    END IF;

    INSERT INTO public.tasks(
      user_id,cycle_id,title,description,task_level,status,progress,reward,
      start_date,due_date,offer_id,task_value
    )
    VALUES(
      u.id,c.id,offer_row.title,
      COALESCE(offer_row.subtitle,offer_row.instructions,'Complete the assigned Shop task.'),
      COALESCE(offer_row.task_level,'CLIENT'),'Pending',0,task_reward,
      CURRENT_DATE,CURRENT_DATE+1,offer_row.id::text,task_value
    );
  END LOOP;

  INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
  VALUES(
    u.id,'CYCLE_AUTO_ASSIGNED','New Shop tasks assigned automatically',
    'Your available balance is above $0. A new Shop task cycle has been opened automatically. No Master Admin task assignment is required. Complete the full task set to start the 18-hour settlement timer.',
    FALSE
  );

  RETURN c.id;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_auto_task_cycle(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_auto_task_cycle(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.create_cycle_for_verified_deposit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  u public.users;
  t public.vip_tiers;
  c public.cycle_runs;
  offer_row RECORD;
  offer_count integer:=0;
  offer_index integer:=0;
  task_value numeric(18,2);
  task_reward numeric(18,2);
  remaining_value numeric(18,2);
  remaining_reward numeric(18,2);
  cycle_base numeric(18,2);
BEGIN
  IF NEW.status<>'VERIFIED' OR COALESCE(OLD.status,'')='VERIFIED' THEN RETURN NEW; END IF;

  SELECT * INTO u FROM public.users WHERE id=NEW.user_id FOR UPDATE;
  SELECT * INTO t FROM public.vip_tiers WHERE id=NEW.tier_id AND enabled=true;

  IF u.id IS NULL OR t.id IS NULL THEN RETURN NEW; END IF;
  IF upper(coalesce(u.status,'')) NOT IN ('ACTIVE','NORMAL') THEN RETURN NEW; END IF;
  IF u.frozen_until IS NOT NULL AND u.frozen_until > NOW() THEN
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM public.cycle_runs WHERE source_deposit_id=NEW.id) THEN RETURN NEW; END IF;

  cycle_base:=ROUND(GREATEST(0,COALESCE(NEW.gross_amount,0)-COALESCE(NEW.deposit_fee,0)),2);

  SELECT COUNT(*) INTO offer_count
  FROM public.shop_offers so
  JOIN public.vip_tiers vt ON vt.id=so.tier_min_id
  WHERE so.status='ACTIVE' AND vt.enabled=true AND vt.display_order<=t.display_order
    AND so.product_id IS NOT NULL;

  INSERT INTO public.cycle_runs(user_id,tier_id,cycle_base,status,profit_amount,source_deposit_id)
  VALUES(u.id,t.id,cycle_base,'TASKS_OPEN',ROUND(COALESCE(t.initial_profit,0),2),NEW.id)
  RETURNING * INTO c;

  remaining_value:=cycle_base;
  remaining_reward:=ROUND(COALESCE(t.initial_profit,0),2);

  IF offer_count>0 THEN
    FOR offer_row IN
      SELECT so.id,so.title,so.subtitle,so.task_level,so.instructions,so.product_id,vt.display_order
      FROM public.shop_offers so
      JOIN public.vip_tiers vt ON vt.id=so.tier_min_id
      WHERE so.status='ACTIVE' AND vt.enabled=true AND vt.display_order<=t.display_order
        AND so.product_id IS NOT NULL
      ORDER BY vt.display_order,so.created_at,so.id
    LOOP
      offer_index:=offer_index+1;
      IF offer_index=offer_count THEN
        task_value:=ROUND(remaining_value,2);
        task_reward:=ROUND(remaining_reward,2);
      ELSE
        task_value:=ROUND(cycle_base/offer_count,2);
        task_reward:=ROUND(COALESCE(t.initial_profit,0)/offer_count,2);
        remaining_value:=ROUND(remaining_value-task_value,2);
        remaining_reward:=ROUND(remaining_reward-task_reward,2);
      END IF;

      INSERT INTO public.tasks(
        user_id,cycle_id,title,description,task_level,status,progress,reward,
        start_date,due_date,offer_id,task_value
      )
      VALUES(
        u.id,c.id,offer_row.title,
        COALESCE(offer_row.subtitle,offer_row.instructions,'Complete the assigned Shop task.'),
        COALESCE(offer_row.task_level,'CLIENT'),'Pending',0,task_reward,
        CURRENT_DATE,CURRENT_DATE+1,offer_row.id::text,task_value
      );
    END LOOP;
  END IF;

  INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
  VALUES(
    u.id,'CYCLE_STARTED','Shop cycle is ready',
    CASE WHEN offer_count>0 THEN
      'Your verified deposit created a new Shop cycle with assigned tasks. Open Shop, complete each mapped task, and the 18-hour settlement timer starts after the final task.'
    ELSE
      'Your verified deposit created a Shop cycle, but no mapped active Shop offers are configured yet.'
    END,false
  );

  RETURN NEW;
END;
$function$;

COMMIT;
