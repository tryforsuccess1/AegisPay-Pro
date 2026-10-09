CREATE OR REPLACE FUNCTION public.settle_due_cycles()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.cycle_runs;
  u public.users;
  t public.vip_tiers;
  settled integer := 0;
  v_rate numeric(18,8);
  v_profit numeric(18,2);
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

    SELECT * INTO t
    FROM public.vip_tiers
    WHERE id=c.tier_id
    FOR SHARE;

    v_rate := CASE
      WHEN t.id IS NOT NULL AND COALESCE(t.deposit_amount,0) > 0
        THEN COALESCE(t.initial_profit,0) / t.deposit_amount
      ELSE 0
    END;

    v_profit := ROUND(COALESCE(c.cycle_base,0) * v_rate,2);

    UPDATE public.users
      SET current_platform_balance=COALESCE(current_platform_balance,0)+v_profit,
          profit_balance=COALESCE(profit_balance,0)+v_profit
      WHERE id=u.id;

    UPDATE public.cycle_runs
      SET status='SETTLED',
          settled_at=NOW(),
          profit_amount=v_profit
      WHERE id=c.id;

    INSERT INTO public.account_ledger(
      user_id,entry_type,amount,description,reference_id,metadata
    )
    VALUES(
      u.id,'CYCLE_PROFIT',v_profit,'18-hour Shop cycle settlement',c.id::TEXT,
      jsonb_build_object(
        'cycle_base',c.cycle_base,
        'profit',v_profit,
        'tier_id',c.tier_id,
        'tier_rate',v_rate
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

REVOKE ALL ON FUNCTION public.settle_due_cycles() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_due_cycles() TO service_role;