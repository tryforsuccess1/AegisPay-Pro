-- Phase 3: align Master Admin readiness RPC output with production_config.
-- The admin UI can use one authoritative readiness payload without guessing
-- production_config values from a second diagnostic response.

CREATE OR REPLACE FUNCTION public.get_production_readiness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_status text;
  v_system jsonb := '{}'::jsonb;
  v_deposit jsonb := '{}'::jsonb;
  v_prod jsonb := '{}'::jsonb;
  v_runtime boolean := false;
  v_address text := '';
  v_network text := '';
  v_mode text := '';
  v_environment text := 'PRE_PRODUCTION';
  v_live_deposits boolean := false;
  v_real_payouts boolean := false;
  v_go_live boolean := false;
  v_prod_live_deposits boolean := false;
  v_prod_real_payouts boolean := false;
  v_prod_go_live boolean := false;
  v_payouts_locked boolean := true;
  v_config_consistent boolean := true;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required';
  END IF;

  SELECT role, status
    INTO v_role, v_status
  FROM public.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_role <> 'MASTER ADMIN'
     OR upper(COALESCE(v_status, '')) NOT IN ('ACTIVE','NORMAL') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active Master Admin access is required';
  END IF;

  SELECT value_json INTO v_system FROM public.platform_settings WHERE key='system_mode';
  SELECT value_json INTO v_deposit FROM public.platform_settings WHERE key='deposit_rules';
  SELECT value_json INTO v_prod FROM public.platform_settings WHERE key='production_config';

  v_mode := upper(COALESCE(v_system->>'mode',''));
  v_network := upper(COALESCE(v_deposit->>'network',''));
  v_address := trim(COALESCE(v_deposit->>'receiving_address',''));
  v_environment := upper(COALESCE(v_prod->>'environment','PRE_PRODUCTION'));
  v_live_deposits := COALESCE((v_system->>'live_deposits')::boolean, false);
  v_real_payouts := COALESCE((v_system->>'real_payouts')::boolean, false);
  v_go_live := COALESCE((v_system->>'production_go_live_approved')::boolean, false);
  v_prod_live_deposits := COALESCE((v_prod->>'live_deposits_enabled')::boolean, false);
  v_prod_real_payouts := COALESCE((v_prod->>'real_payouts_enabled')::boolean, false);
  v_prod_go_live := COALESCE((v_prod->>'go_live_approved')::boolean, false);
  v_payouts_locked := COALESCE((v_prod->>'payouts_locked')::boolean, true);

  v_config_consistent := (
    v_live_deposits = v_prod_live_deposits
    AND v_real_payouts = v_prod_real_payouts
    AND v_go_live = v_prod_go_live
  );

  BEGIN
    v_runtime := public.app_runtime_enabled();
  EXCEPTION WHEN OTHERS THEN
    v_runtime := false;
  END;

  RETURN jsonb_build_object(
    'environment', v_environment,
    'system_mode', v_mode,
    'system_status', COALESCE(v_system->>'status',''),
    'network', v_network,
    'receiving_address_configured', (v_address <> ''),
    'live_deposits', v_live_deposits,
    'production_config_live_deposits', v_prod_live_deposits,
    'real_payouts', v_real_payouts,
    'production_config_real_payouts', v_prod_real_payouts,
    'production_go_live_approved', v_go_live,
    'production_config_go_live_approved', v_prod_go_live,
    'payouts_locked', v_payouts_locked,
    'runtime_enabled', v_runtime,
    'configuration_consistent', v_config_consistent,
    'mainnet_base_config_ok', (
      v_mode = 'MAINNET'
      AND v_network = 'TRON MAINNET'
      AND v_address <> ''
    ),
    'mainnet_deposit_gate_ok', (
      v_mode = 'MAINNET'
      AND v_network = 'TRON MAINNET'
      AND v_address <> ''
      AND v_live_deposits
    ),
    'mainnet_payout_gate_ok', (
      v_environment = 'PRODUCTION'
      AND v_mode = 'MAINNET'
      AND v_network = 'TRON MAINNET'
      AND v_real_payouts
      AND v_prod_real_payouts
      AND v_go_live
      AND v_prod_go_live
      AND NOT v_payouts_locked
    ),
    'payout_gate_enforced_server_side', true,
    'server_side_secrets_required', true,
    'cron_secret_required_for_monitoring', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_production_readiness() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_production_readiness() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_production_readiness() TO authenticated;
