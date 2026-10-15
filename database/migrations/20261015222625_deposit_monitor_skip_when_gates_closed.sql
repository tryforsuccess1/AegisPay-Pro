-- Avoid repeatedly invoking the Mainnet deposit monitor while AegisPay's
-- fail-closed production flags explicitly keep Mainnet deposits disabled.
-- The Edge Function retains the authoritative readiness/secret/payout checks;
-- this cron-side predicate only suppresses known-paused background requests.
DO $migration$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'pg_cron must be installed before scheduling the AegisPay deposit monitor';
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault must be available for the AegisPay monitor cron secret';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    RAISE EXCEPTION 'pg_net must be installed before scheduling the AegisPay deposit monitor';
  END IF;

  PERFORM cron.unschedule('aegispay-mainnet-deposit-monitor');

  v_job_id := cron.schedule(
    'aegispay-mainnet-deposit-monitor',
    '* * * * *',
    $job$
    DO $monitor$
    DECLARE
      v_system jsonb := '{}'::jsonb;
      v_deposit jsonb := '{}'::jsonb;
      v_production jsonb := '{}'::jsonb;
    BEGIN
      SELECT COALESCE(value_json, '{}'::jsonb) INTO v_system
      FROM public.platform_settings WHERE key = 'system_mode';
      SELECT COALESCE(value_json, '{}'::jsonb) INTO v_deposit
      FROM public.platform_settings WHERE key = 'deposit_rules';
      SELECT COALESCE(value_json, '{}'::jsonb) INTO v_production
      FROM public.platform_settings WHERE key = 'production_config';

      -- Match the explicit configuration gates checked by monitor-deposits.
      -- Secrets, unresolved payouts, and all transaction checks remain checked
      -- by the Edge Function itself whenever the broad gates are intentionally open.
      IF upper(COALESCE(v_system->>'mode', '')) = 'MAINNET'
         AND upper(COALESCE(v_deposit->>'network', '')) = 'TRON MAINNET'
         AND COALESCE(v_deposit->>'token_contract', '') = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
         AND COALESCE((v_system->>'live_deposits')::boolean, false)
         AND COALESCE((v_system->>'real_payouts')::boolean, false)
         AND COALESCE((v_system->>'production_go_live_approved')::boolean, false)
         AND upper(COALESCE(v_production->>'environment', '')) = 'PRODUCTION'
         AND COALESCE((v_production->>'live_deposits_enabled')::boolean, false)
         AND COALESCE((v_production->>'real_payouts_enabled')::boolean, false)
         AND COALESCE((v_production->>'go_live_approved')::boolean, false)
         AND COALESCE((v_production->>'payouts_locked')::boolean, true) = false
      THEN
        PERFORM net.http_post(
          url := 'https://wtcspnrmsoisroavojop.supabase.co/functions/v1/monitor-deposits',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-aegis-cron-secret', (
              SELECT decrypted_secret
              FROM vault.decrypted_secrets
              WHERE name = 'aegispay_monitor_deposit_cron'
              LIMIT 1
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 10000
        );
      END IF;
    END;
    $monitor$;
    $job$
  );

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Unable to schedule the guarded AegisPay deposit monitor';
  END IF;
END;
$migration$;
