-- Provide a service-role-only RPC for the authenticated production-readiness Edge Function.
-- The Edge Function authenticates the caller and checks the active Master Admin profile;
-- this function independently rechecks that identity before writing any production controls.
-- The legacy set_production_config RPC stays restricted from authenticated clients.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_production_config_from_admin_edge(
  p_actor_auth_user_id uuid,
  p_environment text,
  p_live_deposits_enabled boolean,
  p_real_payouts_enabled boolean,
  p_go_live_approved boolean,
  p_payouts_locked boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid;
  v_role text;
  v_status text;
  v_env text := upper(trim(COALESCE(p_environment, '')));
  v_system jsonb := '{}'::jsonb;
  v_deposit jsonb := '{}'::jsonb;
  v_prod jsonb := '{}'::jsonb;
  v_addr text := '';
  v_network text := '';
  v_contract text := '';
  v_mode text := '';
  v_runtime boolean := false;
  v_mainnet_ready boolean := false;
  v_unreconciled_count integer := 0;
BEGIN
  IF p_actor_auth_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated actor is required';
  END IF;

  SELECT id, role, status
    INTO v_actor, v_role, v_status
    FROM public.users
   WHERE auth_user_id = p_actor_auth_user_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AegisPay profile not found';
  END IF;
  IF v_role IS DISTINCT FROM 'MASTER ADMIN'
     OR upper(COALESCE(v_status, '')) NOT IN ('ACTIVE', 'NORMAL') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active Master Admin access is required';
  END IF;

  IF v_env NOT IN ('PRE_PRODUCTION', 'PRODUCTION') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Environment must be PRE_PRODUCTION or PRODUCTION';
  END IF;

  SELECT COALESCE(value_json, '{}'::jsonb) INTO v_system
    FROM public.platform_settings WHERE key = 'system_mode';
  SELECT COALESCE(value_json, '{}'::jsonb) INTO v_deposit
    FROM public.platform_settings WHERE key = 'deposit_rules';
  SELECT COALESCE(value_json, '{}'::jsonb) INTO v_prod
    FROM public.platform_settings WHERE key = 'production_config';

  v_addr := trim(COALESCE(v_deposit->>'receiving_address', ''));
  v_network := upper(COALESCE(v_deposit->>'network', ''));
  v_contract := trim(COALESCE(v_deposit->>'token_contract', ''));
  v_mode := upper(COALESCE(v_system->>'mode', ''));

  -- Only the official TRON Mainnet USDT contract can pass production readiness.
  v_mainnet_ready := (
    v_mode = 'MAINNET'
    AND v_network = 'TRON MAINNET'
    AND v_addr ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
    AND v_contract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
  );

  BEGIN
    v_runtime := public.app_runtime_enabled();
  EXCEPTION WHEN OTHERS THEN
    v_runtime := false;
  END;

  IF v_env = 'PRE_PRODUCTION' AND COALESCE(p_real_payouts_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Real payouts cannot be enabled in PRE_PRODUCTION';
  END IF;
  IF COALESCE(p_real_payouts_enabled, false) AND NOT COALESCE(p_go_live_approved, false) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Go-Live approval is required before real payouts can be enabled';
  END IF;
  IF COALESCE(p_real_payouts_enabled, false) AND COALESCE(p_payouts_locked, true) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payout lock must be OPEN before real payouts can be enabled';
  END IF;
  IF COALESCE(p_real_payouts_enabled, false) AND NOT v_mainnet_ready THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MAINNET, official TRON USDT and a valid receiving address are required before real payouts';
  END IF;
  IF COALESCE(p_live_deposits_enabled, false) AND (
    v_env <> 'PRODUCTION'
    OR NOT COALESCE(p_real_payouts_enabled, false)
    OR NOT COALESCE(p_go_live_approved, false)
    OR COALESCE(p_payouts_locked, true)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Live Mainnet deposits require approved PRODUCTION mode, real payouts enabled and payout lock open';
  END IF;
  IF COALESCE(p_real_payouts_enabled, false) AND NOT v_runtime THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'AegisPay runtime must be enabled before real payouts';
  END IF;

  IF COALESCE(p_real_payouts_enabled, false) THEN
    SELECT count(*) INTO v_unreconciled_count
      FROM public.withdrawal_requests
     WHERE status IN ('APPROVED', 'PROCESSING') AND payout_txid IS NULL;
    IF v_unreconciled_count > 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'Cannot enable real payouts until approved/processing withdrawals without a TXID are reconciled. Pending count: ' || v_unreconciled_count::text;
    END IF;
  END IF;

  INSERT INTO public.platform_settings(key, value_json, updated_at) VALUES(
    'production_config',
    jsonb_build_object(
      'environment', v_env,
      'go_live_approved', COALESCE(p_go_live_approved, false),
      'real_payouts_enabled', COALESCE(p_real_payouts_enabled, false),
      'live_deposits_enabled', COALESCE(p_live_deposits_enabled, false),
      'payouts_locked', COALESCE(p_payouts_locked, true),
      'configured_by', v_actor,
      'configured_at', now()
    ),
    now()
  )
  ON CONFLICT(key) DO UPDATE
    SET value_json = EXCLUDED.value_json, updated_at = now();

  UPDATE public.platform_settings
     SET value_json = value_json || jsonb_build_object(
       'production_go_live_approved', COALESCE(p_go_live_approved, false),
       'real_payouts', COALESCE(p_real_payouts_enabled, false),
       'live_deposits', COALESCE(p_live_deposits_enabled, false)
     ),
     updated_at = now()
   WHERE key = 'system_mode';

  INSERT INTO public.audit_events(actor_user_id, event_type, description)
  VALUES(
    v_actor,
    'PRODUCTION_CONFIG_UPDATED',
    'Phase 3 production configuration updated via authenticated admin Edge Function: environment=' || v_env ||
    ', live_deposits=' || COALESCE(p_live_deposits_enabled, false)::text ||
    ', real_payouts=' || COALESCE(p_real_payouts_enabled, false)::text ||
    ', go_live_approved=' || COALESCE(p_go_live_approved, false)::text ||
    ', payouts_locked=' || COALESCE(p_payouts_locked, true)::text
  );

  SELECT COALESCE(value_json, '{}'::jsonb) INTO v_system
    FROM public.platform_settings WHERE key = 'system_mode';
  SELECT COALESCE(value_json, '{}'::jsonb) INTO v_prod
    FROM public.platform_settings WHERE key = 'production_config';

  RETURN jsonb_build_object(
    'environment', COALESCE(v_prod->>'environment', 'PRE_PRODUCTION'),
    'system_mode', upper(COALESCE(v_system->>'mode', '')),
    'system_status', COALESCE(v_system->>'status', ''),
    'network', v_network,
    'receiving_address_configured', (v_addr <> ''),
    'live_deposits', COALESCE((v_system->>'live_deposits')::boolean, false),
    'real_payouts', COALESCE((v_system->>'real_payouts')::boolean, false),
    'production_go_live_approved', COALESCE((v_system->>'production_go_live_approved')::boolean, false),
    'payouts_locked', COALESCE((v_prod->>'payouts_locked')::boolean, true),
    'production_config_live_deposits', COALESCE((v_prod->>'live_deposits_enabled')::boolean, false),
    'production_config_real_payouts', COALESCE((v_prod->>'real_payouts_enabled')::boolean, false),
    'production_config_go_live_approved', COALESCE((v_prod->>'go_live_approved')::boolean, false),
    'runtime_enabled', v_runtime,
    'configuration_consistent', (
      COALESCE((v_system->>'live_deposits')::boolean, false) = COALESCE((v_prod->>'live_deposits_enabled')::boolean, false)
      AND COALESCE((v_system->>'real_payouts')::boolean, false) = COALESCE((v_prod->>'real_payouts_enabled')::boolean, false)
      AND COALESCE((v_system->>'production_go_live_approved')::boolean, false) = COALESCE((v_prod->>'go_live_approved')::boolean, false)
    ),
    'mainnet_base_config_ok', v_mainnet_ready,
    'mainnet_deposit_gate_ok', (
      v_mainnet_ready
      AND COALESCE((v_system->>'live_deposits')::boolean, false)
      AND COALESCE((v_prod->>'live_deposits_enabled')::boolean, false)
    ),
    'mainnet_payout_gate_ok', (
      upper(COALESCE(v_prod->>'environment', 'PRE_PRODUCTION')) = 'PRODUCTION'
      AND v_mainnet_ready
      AND COALESCE((v_system->>'real_payouts')::boolean, false)
      AND COALESCE((v_prod->>'real_payouts_enabled')::boolean, false)
      AND COALESCE((v_system->>'production_go_live_approved')::boolean, false)
      AND COALESCE((v_prod->>'go_live_approved')::boolean, false)
      AND NOT COALESCE((v_prod->>'payouts_locked')::boolean, true)
      AND v_runtime
    ),
    'payout_gate_enforced_server_side', true,
    'server_side_secrets_required', true,
    'cron_secret_required_for_monitoring', true
  );
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.set_production_config_from_admin_edge(uuid, text, boolean, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_production_config_from_admin_edge(uuid, text, boolean, boolean, boolean, boolean) TO service_role;
COMMENT ON FUNCTION public.set_production_config_from_admin_edge(uuid, text, boolean, boolean, boolean, boolean) IS
  'Service-role-only production config mutation for the production-readiness Edge Function. The function independently verifies the active Master Admin actor and preserves payout/deposit gates.';

COMMIT;
