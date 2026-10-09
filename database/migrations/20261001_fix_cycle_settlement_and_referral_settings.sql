-- AegisPay backend logic fixes: preserve balance at settlement and honor configured referral rewards.

CREATE OR REPLACE FUNCTION public.settle_due_cycles()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.cycle_runs;
  u public.users;
  settled INTEGER := 0;
  v_profit NUMERIC(18,2);
BEGIN
  FOR c IN
    SELECT *
    FROM public.cycle_runs
    WHERE status='WAITING_18H'
      AND ready_at IS NOT NULL
      AND ready_at<=NOW()
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO u
    FROM public.users
    WHERE id=c.user_id
    FOR UPDATE;

    IF u.id IS NULL THEN
      CONTINUE;
    END IF;

    v_profit := ROUND(COALESCE(c.profit_amount,0),2);

    UPDATE public.users
      SET current_platform_balance=COALESCE(current_platform_balance,0)+v_profit,
          profit_balance=COALESCE(profit_balance,0)+v_profit
      WHERE id=u.id;

    UPDATE public.cycle_runs
      SET status='SETTLED',settled_at=NOW()
      WHERE id=c.id;

    INSERT INTO public.account_ledger(
      user_id,entry_type,amount,description,reference_id,metadata
    )
    VALUES(
      u.id,'CYCLE_PROFIT',v_profit,'18-hour Shop cycle settlement',c.id::TEXT,
      jsonb_build_object(
        'cycle_base',c.cycle_base,
        'profit',v_profit,
        'tier_id',c.tier_id
      )
    );

    INSERT INTO public.notifications(
      user_id,notification_type,title,body,is_read
    )
    VALUES(
      u.id,'CYCLE_SETTLED','Profit credited',
      'Your 18-hour Shop cycle has settled and the new balance is available.',
      FALSE
    );

    settled := settled + 1;
  END LOOP;

  RETURN settled;
END;
$function$;

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
  SELECT * INTO d
  FROM public.deposit_submissions
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Deposit not found';
  END IF;

  IF d.status <> 'PENDING_VERIFICATION' THEN
    RETURN d;
  END IF;

  IF d.ai_review_status NOT IN ('APPROVED','MANUAL_APPROVED') THEN
    RAISE EXCEPTION 'Deposit evidence must be approved before credit';
  END IF;

  SELECT value_json INTO v_rules
  FROM public.platform_settings
  WHERE key = 'deposit_rules';

  v_network := upper(COALESCE(v_rules ->> 'network',''));
  v_contract := COALESCE(v_rules ->> 'token_contract','');

  IF v_network = 'TRON TESTNET' THEN
    v_contract := COALESCE(NULLIF(v_contract,''),'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs');
  ELSIF v_network = 'TRON MAINNET' THEN
    SELECT value_json INTO v_mode
    FROM public.platform_settings
    WHERE key = 'system_mode';

    IF COALESCE(v_mode ->> 'mode','') <> 'MAINNET'
       OR COALESCE((v_mode ->> 'real_payouts')::BOOLEAN,FALSE) IS NOT TRUE THEN
      RAISE EXCEPTION 'Mainnet deposit crediting is disabled in test mode';
    END IF;

    v_contract := COALESCE(NULLIF(v_contract,''),'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  ELSE
    RAISE EXCEPTION 'Unsupported TRON deposit network';
  END IF;

  SELECT * INTO u
  FROM public.users
  WHERE id = d.user_id
  FOR UPDATE;

  SELECT * INTO t
  FROM public.vip_tiers
  WHERE id = d.tier_id;

  IF u.id IS NULL OR t.id IS NULL THEN
    RAISE EXCEPTION 'User or tier not found';
  END IF;

  credited := GREATEST(0,d.gross_amount-d.deposit_fee);

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
      first_deposit_done=TRUE,
      selected_tier_id=t.id
  WHERE id=u.id;

  INSERT INTO public.account_ledger(
    user_id,entry_type,amount,description,reference_id,metadata
  )
  VALUES(
    u.id,'USER_DEPOSIT',credited,'Verified TRON USDT deposit credit',d.id::TEXT,
    jsonb_build_object(
      'gross',d.gross_amount,
      'fee',d.deposit_fee,
      'txid',d.txid,
      'tier',t.name,
      'network',v_network,
      'token_contract',v_contract
    )
  );

  INSERT INTO public.audit_events(
    actor_user_id,target_user_id,event_type,description,reference_id
  )
  VALUES(
    NULL,u.id,'DEPOSIT_VERIFIED',
    'Deposit verified from confirmed TRON transfer',
    d.id::TEXT
  );

  SELECT * INTO parent_user
  FROM public.users
  WHERE id=u.referred_by
  FOR UPDATE;

  SELECT value_json INTO v_ref_rules
  FROM public.platform_settings
  WHERE key='referral_rules';

  v_l1 := GREATEST(0,COALESCE((v_ref_rules ->> 'level_1')::NUMERIC,5));
  v_l2 := GREATEST(0,COALESCE((v_ref_rules ->> 'level_2')::NUMERIC,2));

  IF parent_user.id IS NOT NULL THEN
    IF v_l1 > 0
       AND NOT EXISTS(
         SELECT 1
         FROM public.referrals
         WHERE user_id=parent_user.id
           AND referred_user_id=u.id
           AND referral_level=1
       )
    THEN
      UPDATE public.users
      SET current_platform_balance=COALESCE(current_platform_balance,0)+v_l1,
          profit_balance=COALESCE(profit_balance,0)+v_l1
      WHERE id=parent_user.id;

      INSERT INTO public.referrals(
        user_id,referred_user_id,referral_level,platform_reward,created_at
      )
      VALUES(parent_user.id,u.id,1,v_l1,NOW());

      INSERT INTO public.account_ledger(
        user_id,entry_type,amount,description,reference_id
      )
      VALUES(
        parent_user.id,'REFERRAL_L1',v_l1,
        'Direct referral first verified deposit bonus',d.id::TEXT
      );
    END IF;

    SELECT * INTO r
    FROM public.users
    WHERE id=parent_user.referred_by
    FOR UPDATE;

    IF r.id IS NOT NULL
       AND v_l2 > 0
       AND NOT EXISTS(
         SELECT 1
         FROM public.referrals
         WHERE user_id=r.id
           AND referred_user_id=u.id
           AND referral_level=2
       )
    THEN
      UPDATE public.users
      SET current_platform_balance=COALESCE(current_platform_balance,0)+v_l2,
          profit_balance=COALESCE(profit_balance,0)+v_l2
      WHERE id=r.id;

      INSERT INTO public.referrals(
        user_id,referred_user_id,referral_level,platform_reward,created_at
      )
      VALUES(r.id,u.id,2,v_l2,NOW());

      INSERT INTO public.account_ledger(
        user_id,entry_type,amount,description,reference_id
      )
      VALUES(
        r.id,'REFERRAL_L2',v_l2,
        'Second-level referral first verified deposit bonus',d.id::TEXT
      );
    END IF;
  END IF;

  RETURN d;
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_due_cycles() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_due_cycles() TO service_role;

REVOKE ALL ON FUNCTION public.apply_verified_deposit(uuid,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_deposit(uuid,text,text,timestamptz,text) TO service_role;
