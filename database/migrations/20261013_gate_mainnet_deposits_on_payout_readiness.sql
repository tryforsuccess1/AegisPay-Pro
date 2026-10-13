-- Mainnet deposits must stay closed until production payout controls are approved and operational.
CREATE OR REPLACE FUNCTION public.set_production_config(
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
  v_addr text := '';
  v_network text := '';
  v_mode text := '';
  v_runtime boolean := false;
  v_mainnet_ready boolean := false;
  v_unreconciled_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required';
  END IF;

  SELECT id, role, status
    INTO v_actor, v_role, v_status
    FROM public.users
   WHERE auth_user_id = auth.uid()
   LIMIT 1;

  IF v_role <> 'MASTER ADMIN' OR upper(COALESCE(v_status, '')) NOT IN ('ACTIVE', 'NORMAL') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active Master Admin access is required';
  END IF;

  IF v_env NOT IN ('PRE_PRODUCTION', 'PRODUCTION') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Environment must be PRE_PRODUCTION or PRODUCTION';
  END IF;

  SELECT COALESCE(value_json, '{}'::jsonb) INTO v_system
    FROM public.platform_settings WHERE key = 'system_mode';
  SELECT COALESCE(value_json, '{}'::jsonb) INTO v_deposit
    FROM public.platform_settings WHERE key = 'deposit_rules';

  v_addr := trim(COALESCE(v_deposit->>'receiving_address', ''));
  v_network := upper(COALESCE(v_deposit->>'network', ''));
  v_mode := upper(COALESCE(v_system->>'mode', ''));
  v_mainnet_ready := (v_mode = 'MAINNET' AND v_network = 'TRON MAINNET' AND v_addr ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$');

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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MAINNET/TRON MAINNET and a valid receiving address are required before real payouts';
  END IF;
  IF COALESCE(p_live_deposits_enabled, false) AND (
    v_env <> 'PRODUCTION'
    OR NOT COALESCE(p_real_payouts_enabled, false)
    OR NOT COALESCE(p_go_live_approved, false)
    OR COALESCE(p_payouts_locked, true)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Live mainnet deposits require approved PRODUCTION mode with real payouts enabled and the payout lock open';
  END IF;
  IF COALESCE(p_live_deposits_enabled, false) AND v_env = 'PRODUCTION' AND NOT v_mainnet_ready THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MAINNET/TRON MAINNET and a valid receiving address are required before live deposits';
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
        MESSAGE = 'Cannot enable real payouts until all approved/processing withdrawals without a transaction ID are reconciled. Pending reconciliation count: ' || v_unreconciled_count::text;
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
    'Phase 3 production configuration updated: environment=' || v_env ||
    ', live_deposits=' || COALESCE(p_live_deposits_enabled, false)::text ||
    ', real_payouts=' || COALESCE(p_real_payouts_enabled, false)::text ||
    ', go_live_approved=' || COALESCE(p_go_live_approved, false)::text ||
    ', payouts_locked=' || COALESCE(p_payouts_locked, true)::text
  );

  RETURN public.get_production_readiness();
END;
$function$;

-- Preserve the existing pre-production posture; do not accept live deposits while payouts are locked.
UPDATE public.platform_settings
   SET value_json = value_json || jsonb_build_object(
     'environment', 'PRE_PRODUCTION',
     'live_deposits_enabled', false,
     'real_payouts_enabled', false,
     'go_live_approved', false,
     'payouts_locked', true
   ),
   updated_at = now()
 WHERE key = 'production_config'
   AND NOT (
     value_json->>'environment' = 'PRODUCTION'
     AND value_json->>'live_deposits_enabled' = 'true'
     AND value_json->>'real_payouts_enabled' = 'true'
     AND value_json->>'go_live_approved' = 'true'
     AND value_json->>'payouts_locked' = 'false'
   );

UPDATE public.platform_settings AS mode
   SET value_json = mode.value_json || jsonb_build_object(
     'live_deposits', false,
     'real_payouts', false,
     'production_go_live_approved', false,
     'status', 'PRE_PRODUCTION_PAYOUTS_LOCKED'
   ),
   updated_at = now()
 WHERE mode.key = 'system_mode'
   AND mode.value_json->>'mode' = 'MAINNET'
   AND NOT EXISTS (
     SELECT 1
       FROM public.platform_settings AS production
      WHERE production.key = 'production_config'
        AND production.value_json->>'environment' = 'PRODUCTION'
        AND production.value_json->>'live_deposits_enabled' = 'true'
        AND production.value_json->>'real_payouts_enabled' = 'true'
        AND production.value_json->>'go_live_approved' = 'true'
        AND production.value_json->>'payouts_locked' = 'false'
   );
