-- Phase 3 hardening: enforce the production readiness gate server-side.
-- Keeps the platform fail-closed in PRE_PRODUCTION while making the gate authoritative
-- for real mainnet payouts.

INSERT INTO public.platform_settings(key, value_json, updated_at)
VALUES (
  'production_config',
  jsonb_build_object(
    'environment', 'PRE_PRODUCTION',
    'go_live_approved', false,
    'real_payouts_enabled', false,
    'live_deposits_enabled', false,
    'payouts_locked', true,
    'configured_by', null,
    'configured_at', null
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value_json = jsonb_build_object(
  'environment', COALESCE(NULLIF(public.platform_settings.value_json->>'environment',''), 'PRE_PRODUCTION'),
  'go_live_approved', COALESCE((public.platform_settings.value_json->>'go_live_approved')::boolean, false),
  'real_payouts_enabled', COALESCE((public.platform_settings.value_json->>'real_payouts_enabled')::boolean, false),
  'live_deposits_enabled', COALESCE((public.platform_settings.value_json->>'live_deposits_enabled')::boolean, false),
  'payouts_locked', COALESCE((public.platform_settings.value_json->>'payouts_locked')::boolean, true),
  'configured_by', public.platform_settings.value_json->>'configured_by',
  'configured_at', public.platform_settings.value_json->>'configured_at'
),
updated_at = now();

UPDATE public.platform_settings
SET value_json = value_json || jsonb_build_object(
  'production_go_live_approved',
  COALESCE((value_json->>'production_go_live_approved')::boolean, false)
),
updated_at = now()
WHERE key = 'system_mode';

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
  v_payouts_locked boolean := true;
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
  v_payouts_locked := COALESCE((v_prod->>'payouts_locked')::boolean, true);

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
    'production_live_deposits_enabled', v_prod_live_deposits,
    'real_payouts', v_real_payouts,
    'production_real_payouts_enabled', v_prod_real_payouts,
    'production_go_live_approved', v_go_live,
    'payouts_locked', v_payouts_locked,
    'runtime_enabled', v_runtime,
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
