-- AegisPay tier activation and per-task completion workflow
-- Deposits may be any amount >= the platform's $10 minimum.
-- A verified deposit does NOT select a tier or create Shop tasks by itself.
-- Client selects one of the enabled tiers after the balance is credited.
-- Selecting a tier creates the normal task cycle automatically.
-- Each task is completed individually; when the last task is completed,
-- the cycle automatically moves to WAITING_18H.

CREATE OR REPLACE FUNCTION public.ai_activate_tier(p_tier_id TEXT)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user public.users;
  v_tier public.vip_tiers;
  v_available NUMERIC(18,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication is required';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE auth_user_id = auth.uid()
  FOR UPDATE;

  IF v_user.id IS NULL OR v_user.role <> 'USER' THEN
    RAISE EXCEPTION 'Client profile not found';
  END IF;

  IF upper(COALESCE(v_user.status,'')) NOT IN ('ACTIVE','NORMAL') THEN
    RAISE EXCEPTION 'This account is not active';
  END IF;

  IF v_user.frozen_until IS NOT NULL AND v_user.frozen_until > NOW() THEN
    RAISE EXCEPTION 'Account is temporarily frozen for security';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cycle_runs
    WHERE user_id = v_user.id
      AND status IN ('TASKS_OPEN','WAITING_18H')
  ) THEN
    RAISE EXCEPTION 'Your current Shop cycle must finish before another tier can be selected';
  END IF;

  SELECT * INTO v_tier
  FROM public.vip_tiers
  WHERE id = p_tier_id
    AND enabled = true;

  IF v_tier.id IS NULL THEN
    RAISE EXCEPTION 'Selected tier is unavailable';
  END IF;

  v_available := ROUND(
    GREATEST(
      0,
      COALESCE(v_user.current_platform_balance,0)
        - GREATEST(COALESCE(v_user.withdrawal_held,0),0)
    ),
    2
  );

  IF v_available < COALESCE(v_tier.deposit_amount,0) THEN
    RAISE EXCEPTION 'Your available balance is below the selected tier requirement';
  END IF;

  UPDATE public.users
  SET selected_tier_id = v_tier.id
  WHERE id = v_user.id
  RETURNING * INTO v_user;

  INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
  VALUES(
    v_user.id,
    'TIER_SELECTED',
    'Tier activated',
    'Your ' || v_tier.name || ' tier has been selected. Your Shop task cycle will now be assigned automatically.',
    FALSE
  );

  RETURN v_user;
END;
$function$;

REVOKE ALL ON FUNCTION public.ai_activate_tier(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_activate_tier(TEXT) TO authenticated;

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
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO u
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

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
    ), 2
  );

  IF available_balance <= 0 THEN RETURN NULL; END IF;

  IF EXISTS (
    SELECT 1 FROM public.cycle_runs
    WHERE user_id=u.id AND status IN ('TASKS_OPEN','WAITING_18H')
  ) THEN
    RETURN NULL;
  END IF;

  -- A user must explicitly select a tier before receiving profit-bearing tasks.
  IF COALESCE(u.selected_tier_id,'')='' THEN RETURN NULL; END IF;

  SELECT * INTO t
  FROM public.vip_tiers
  WHERE id=u.selected_tier_id
    AND enabled=true
    AND COALESCE(deposit_amount,0)<=available_balance
  FOR SHARE;

  IF t.id IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*) INTO offer_count
  FROM public.shop_offers so
  JOIN public.vip_tiers vt ON vt.id=so.tier_min_id
  WHERE so.status='ACTIVE'
    AND vt.enabled=true
    AND vt.display_order<=t.display_order
    AND so.product_id IS NOT NULL;

  IF offer_count<=0 THEN RETURN NULL; END IF;

  tier_rate:=CASE WHEN COALESCE(t.deposit_amount,0)>0
    THEN COALESCE(t.initial_profit,0)/t.deposit_amount ELSE 0 END;

  cycle_profit:=ROUND(available_balance*tier_rate,2);

  INSERT INTO public.cycle_runs(
    user_id,tier_id,cycle_base,status,profit_amount,source_deposit_id
  )
  VALUES(u.id,t.id,available_balance,'TASKS_OPEN',cycle_profit,NULL)
  RETURNING * INTO c;

  remaining_value:=available_balance;
  remaining_reward:=cycle_profit;

  FOR offer_row IN
    SELECT so.id,so.title,so.subtitle,so.task_level,so.instructions,so.product_id,vt.display_order
    FROM public.shop_offers so
    JOIN public.vip_tiers vt ON vt.id=so.tier_min_id
    WHERE so.status='ACTIVE'
      AND vt.enabled=true
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
    u.id,'CYCLE_AUTO_ASSIGNED','New Shop tasks assigned',
    'Your selected tier is active and your Shop task cycle has been assigned automatically. Complete each task individually; the 18-hour settlement starts when the final task is completed.',
    FALSE
  );

  RETURN c.id;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_auto_task_cycle(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_auto_task_cycle(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_verified_deposit(
  p_deposit_id uuid,
  p_sender_address text,
  p_raw_amount text,
  p_block_timestamp timestamp with time zone,
  p_verification_source text DEFAULT 'TronGrid'::text
)
RETURNS public.deposit_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d public.deposit_submissions;
  u public.users;
  t public.vip_tiers;
  parent_user public.users;
  r public.users;
  credited NUMERIC(18,2);
  v_rules JSONB;
  v_mode JSONB;
  v_ref_rules JSONB;
  v_network TEXT;
  v_contract TEXT;
  v_l1 NUMERIC(18,2);
  v_l2 NUMERIC(18,2);
BEGIN
  SELECT * INTO d FROM public.deposit_submissions WHERE id=p_deposit_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Deposit not found'; END IF;
  IF d.status <> 'PENDING_VERIFICATION' THEN RETURN d; END IF;
  IF d.ai_review_status NOT IN ('APPROVED','MANUAL_APPROVED') THEN
    RAISE EXCEPTION 'Deposit evidence must be approved before credit';
  END IF;

  SELECT value_json INTO v_rules FROM public.platform_settings WHERE key='deposit_rules';
  v_network:=upper(COALESCE(v_rules->>'network',''));
  v_contract:=COALESCE(v_rules->>'token_contract','');

  IF v_network='TRON TESTNET' THEN
    v_contract:=COALESCE(NULLIF(v_contract,''),'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs');
  ELSIF v_network='TRON MAINNET' THEN
    SELECT value_json INTO v_mode FROM public.platform_settings WHERE key='system_mode';
    IF COALESCE(v_mode->>'mode','')<>'MAINNET'
       OR COALESCE((v_mode->>'real_payouts')::BOOLEAN,FALSE) IS NOT TRUE THEN
      RAISE EXCEPTION 'Mainnet deposit crediting is disabled in test mode';
    END IF;
    v_contract:=COALESCE(NULLIF(v_contract,''),'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  ELSE
    RAISE EXCEPTION 'Unsupported TRON deposit network';
  END IF;

  SELECT * INTO u FROM public.users WHERE id=d.user_id FOR UPDATE;
  SELECT * INTO t FROM public.vip_tiers WHERE id=d.tier_id;
  IF u.id IS NULL OR t.id IS NULL THEN RAISE EXCEPTION 'User or tier not found'; END IF;

  credited:=GREATEST(0,d.gross_amount-d.deposit_fee);

  UPDATE public.deposit_submissions
  SET status='VERIFIED',
      verified_at=NOW(),
      verification_note='Verified against confirmed TRON TRC20 transfer.',
      network=v_network,
      token_contract=v_contract,
      raw_amount=p_raw_amount,
      sender_address=p_sender_address,
      block_timestamp=p_block_timestamp,
      verification_source=p_verification_source
  WHERE id=d.id
  RETURNING * INTO d;

  UPDATE public.users
  SET current_platform_balance=COALESCE(current_platform_balance,0)+credited,
      principal_balance=COALESCE(principal_balance,0)+credited,
      first_deposit_done=TRUE
  WHERE id=u.id;

  INSERT INTO public.account_ledger(user_id,entry_type,amount,description,reference_id,metadata)
  VALUES(
    u.id,'USER_DEPOSIT',credited,'Verified TRON USDT deposit credit',d.id::TEXT,
    jsonb_build_object('gross',d.gross_amount,'fee',d.deposit_fee,'txid',d.txid,'network',v_network,'token_contract',v_contract)
  );

  INSERT INTO public.audit_events(actor_user_id,target_user_id,event_type,description,reference_id)
  VALUES(NULL,u.id,'DEPOSIT_VERIFIED','Deposit verified from confirmed TRON transfer',d.id::TEXT);

  SELECT * INTO parent_user FROM public.users WHERE id=u.referred_by FOR UPDATE;
  SELECT value_json INTO v_ref_rules FROM public.platform_settings WHERE key='referral_rules';
  v_l1:=GREATEST(0,COALESCE((v_ref_rules->>'level_1')::NUMERIC,5));
  v_l2:=GREATEST(0,COALESCE((v_ref_rules->>'level_2')::NUMERIC,2));

  IF parent_user.id IS NOT NULL THEN
    IF v_l1>0 AND NOT EXISTS(
      SELECT 1 FROM public.referrals
      WHERE user_id=parent_user.id AND referred_user_id=u.id AND referral_level=1
    ) THEN
      UPDATE public.users
      SET current_platform_balance=COALESCE(current_platform_balance,0)+v_l1,
          profit_balance=COALESCE(profit_balance,0)+v_l1
      WHERE id=parent_user.id;
      INSERT INTO public.referrals(user_id,referred_user_id,referral_level,platform_reward,created_at)
      VALUES(parent_user.id,u.id,1,v_l1,NOW());
      INSERT INTO public.account_ledger(user_id,entry_type,amount,description,reference_id)
      VALUES(parent_user.id,'REFERRAL_L1',v_l1,'Direct referral first verified deposit bonus',d.id::TEXT);
    END IF;

    SELECT * INTO r FROM public.users WHERE id=parent_user.referred_by FOR UPDATE;

    IF r.id IS NOT NULL AND v_l2>0 AND NOT EXISTS(
      SELECT 1 FROM public.referrals
      WHERE user_id=r.id AND referred_user_id=u.id AND referral_level=2
    ) THEN
      UPDATE public.users
      SET current_platform_balance=COALESCE(current_platform_balance,0)+v_l2,
          profit_balance=COALESCE(profit_balance,0)+v_l2
      WHERE id=r.id;
      INSERT INTO public.referrals(user_id,referred_user_id,referral_level,platform_reward,created_at)
      VALUES(r.id,u.id,2,v_l2,NOW());
      INSERT INTO public.account_ledger(user_id,entry_type,amount,description,reference_id)
      VALUES(r.id,'REFERRAL_L2',v_l2,'Second-level referral first verified deposit bonus',d.id::TEXT);
    END IF;
  END IF;

  RETURN d;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_verified_deposit(uuid,text,text,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_deposit(uuid,text,text,timestamptz,text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_cycle_for_verified_deposit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  u public.users;
BEGIN
  IF NEW.status<>'VERIFIED' OR COALESCE(OLD.status,'')='VERIFIED' THEN RETURN NEW; END IF;

  SELECT * INTO u FROM public.users WHERE id=NEW.user_id FOR UPDATE;
  IF u.id IS NULL THEN RETURN NEW; END IF;

  -- Deposit verification only credits the balance. A tier must be selected explicitly.
  IF COALESCE(u.selected_tier_id,'')='' THEN
    INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
    VALUES(
      u.id,'DEPOSIT_VERIFIED','Deposit verified',
      'Your deposit has been verified and added to your balance. Select one of the available tiers to activate Shop tasks and profit.',
      FALSE
    );
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_shop_task(p_task_id UUID)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  t public.tasks;
  c public.cycle_runs;
  pending_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication is required';
  END IF;

  v_user_id:=public.current_app_user_id();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AegisPay profile not found'; END IF;

  SELECT * INTO t
  FROM public.tasks
  WHERE id=p_task_id AND user_id=v_user_id
  FOR UPDATE;

  IF t.id IS NULL THEN RAISE EXCEPTION 'Shop task not found'; END IF;
  IF t.status='Completed' THEN RETURN t; END IF;

  SELECT * INTO c
  FROM public.cycle_runs
  WHERE id=t.cycle_id AND user_id=v_user_id
  FOR UPDATE;

  IF c.id IS NULL THEN RAISE EXCEPTION 'Shop cycle not found'; END IF;
  IF c.status<>'TASKS_OPEN' THEN RAISE EXCEPTION 'This Shop cycle is no longer accepting tasks'; END IF;

  UPDATE public.tasks
  SET status='Completed',
      progress=100,
      completion_date=CURRENT_DATE
  WHERE id=t.id AND user_id=v_user_id AND status<>'Completed'
  RETURNING * INTO t;

  SELECT COUNT(*) INTO pending_count
  FROM public.tasks
  WHERE cycle_id=c.id
    AND user_id=v_user_id
    AND status<>'Completed';

  IF pending_count=0 THEN
    UPDATE public.cycle_runs
    SET status='WAITING_18H',
        task_completed_at=NOW(),
        ready_at=NOW()+INTERVAL '18 hours'
    WHERE id=c.id AND user_id=v_user_id AND status='TASKS_OPEN';

    INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
    VALUES
    (
      v_user_id,'SHOP_TASKS_COMPLETED','All Shop tasks completed',
      'You completed every assigned Shop task. The 18-hour settlement timer has started.',
      FALSE
    ),
    (
      v_user_id,'CYCLE_WAITING','18-hour settlement started',
      'Your Shop cycle is now waiting for settlement. No further task action is required.',
      FALSE
    );
  END IF;

  RETURN t;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_shop_task(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_shop_task(UUID) TO authenticated;
