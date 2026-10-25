-- Must run only against the disposable production-config Edge RPC fixture.
DO $tests$
DECLARE
  v_result jsonb;
  v_rejected boolean;
BEGIN
  IF has_function_privilege('anon','public.set_production_config_from_admin_edge(uuid,text,boolean,boolean,boolean,boolean)','EXECUTE')
     OR has_function_privilege('authenticated','public.set_production_config_from_admin_edge(uuid,text,boolean,boolean,boolean,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Production Edge RPC must not be executable by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role','public.set_production_config_from_admin_edge(uuid,text,boolean,boolean,boolean,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Production Edge RPC must be executable by trusted service_role';
  END IF;
  IF has_function_privilege('authenticated','public.set_production_config(text,boolean,boolean,boolean,boolean)','EXECUTE')
     OR has_function_privilege('anon','public.set_production_config(text,boolean,boolean,boolean,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Legacy authenticated production RPC must stay restricted';
  END IF;

  -- Active Master Admin can save a locked pre-production configuration through the backend RPC.
  v_result := public.set_production_config_from_admin_edge(
    '11111111-1111-4111-8111-111111111111', 'PRE_PRODUCTION', false, false, false, true
  );
  IF v_result->>'environment' <> 'PRE_PRODUCTION'
     OR v_result->>'payouts_locked' <> 'true'
     OR v_result->>'configuration_consistent' <> 'true' THEN
    RAISE EXCEPTION 'Safe PRE_PRODUCTION readiness response is incorrect: %', v_result;
  END IF;
  IF (SELECT count(*) FROM public.audit_events WHERE event_type='PRODUCTION_CONFIG_UPDATED') <> 1 THEN
    RAISE EXCEPTION 'Production configuration change did not create an audit event';
  END IF;

  -- A non-admin actor and an inactive Master Admin must be rejected even if called by service_role.
  v_rejected := false;
  BEGIN
    PERFORM public.set_production_config_from_admin_edge(
      '22222222-2222-4222-8222-222222222222', 'PRE_PRODUCTION', false, false, false, true
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Non-admin actor was accepted'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.set_production_config_from_admin_edge(
      '33333333-3333-4333-8333-333333333333', 'PRE_PRODUCTION', false, false, false, true
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Inactive Master Admin actor was accepted'; END IF;

  -- Real payouts must be blocked in PRE_PRODUCTION.
  v_rejected := false;
  BEGIN
    PERFORM public.set_production_config_from_admin_edge(
      '11111111-1111-4111-8111-111111111111', 'PRE_PRODUCTION', false, true, true, false
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Real payouts were accepted in PRE_PRODUCTION'; END IF;

  -- Pending approved/processing withdrawals without TXIDs block payout enablement.
  INSERT INTO public.withdrawal_requests(status, payout_txid) VALUES ('PROCESSING', NULL);
  v_rejected := false;
  BEGIN
    PERFORM public.set_production_config_from_admin_edge(
      '11111111-1111-4111-8111-111111111111', 'PRODUCTION', false, true, true, false
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Unreconciled payout did not block live payout activation'; END IF;
  DELETE FROM public.withdrawal_requests;

  -- Wrong token contract must block real payouts even in PRODUCTION.
  UPDATE public.platform_settings
     SET value_json = value_json || jsonb_build_object('token_contract','TWrongTokenContract')
   WHERE key='deposit_rules';
  v_rejected := false;
  BEGIN
    PERFORM public.set_production_config_from_admin_edge(
      '11111111-1111-4111-8111-111111111111', 'PRODUCTION', false, true, true, false
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Wrong Mainnet token contract did not block payout enablement'; END IF;
  UPDATE public.platform_settings
     SET value_json = value_json || jsonb_build_object('token_contract','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
   WHERE key='deposit_rules';

  -- With the prerequisite rows now satisfied, the response and stored flags stay consistent.
  v_result := public.set_production_config_from_admin_edge(
    '11111111-1111-4111-8111-111111111111', 'PRODUCTION', false, true, true, false
  );
  IF v_result->>'environment' <> 'PRODUCTION'
     OR v_result->>'real_payouts' <> 'true'
     OR v_result->>'payouts_locked' <> 'false'
     OR v_result->>'configuration_consistent' <> 'true'
     OR v_result->>'mainnet_payout_gate_ok' <> 'true' THEN
    RAISE EXCEPTION 'Production payout readiness response is incorrect: %', v_result;
  END IF;

  v_result := public.set_production_config_from_admin_edge(
    '11111111-1111-4111-8111-111111111111', 'PRODUCTION', true, true, true, false
  );
  IF v_result->>'live_deposits' <> 'true'
     OR v_result->>'production_config_live_deposits' <> 'true'
     OR v_result->>'configuration_consistent' <> 'true'
     OR v_result->>'mainnet_deposit_gate_ok' <> 'true' THEN
    RAISE EXCEPTION 'Production deposit readiness response is incorrect: %', v_result;
  END IF;

  RAISE NOTICE 'Production config Edge RPC assertions passed';
END;
$tests$;

SELECT 'Production config Edge RPC assertions: PASS' AS result;
