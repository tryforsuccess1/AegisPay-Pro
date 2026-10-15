-- Behavior tests for the guarded monitor cron command using only stub cron/net/vault schemas.
DO $tests$
DECLARE
  v_command text;
  v_count integer;
  v_headers jsonb;
BEGIN
  SELECT command INTO v_command
  FROM cron.job
  WHERE jobname = 'aegispay-mainnet-deposit-monitor';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'Guarded deposit monitor cron job was not created';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'aegispay-mainnet-deposit-monitor') <> 1 THEN
    RAISE EXCEPTION 'Duplicate deposit monitor cron jobs remain';
  END IF;
  IF (SELECT schedule FROM cron.job WHERE jobname = 'aegispay-mainnet-deposit-monitor') <> '* * * * *' THEN
    RAISE EXCEPTION 'Deposit monitor cron schedule changed unexpectedly';
  END IF;
  IF v_command NOT LIKE '%payouts_locked%' OR v_command NOT LIKE '%production_go_live_approved%'
     OR v_command NOT LIKE '%aegispay_monitor_deposit_cron%' OR v_command NOT LIKE '%net.http_post%' THEN
    RAISE EXCEPTION 'Cron command is missing safety gates, Vault secret lookup, or HTTP request';
  END IF;

  -- With production gates closed, executing the stored command must not enqueue any request.
  EXECUTE v_command;
  SELECT count(*) INTO v_count FROM net.http_calls;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Cron attempted a monitor request while live deposits and payouts are locked';
  END IF;

  -- Open only the simulated gates to confirm that the stored DO command parses and enqueues once.
  UPDATE public.platform_settings SET value_json =
    '{"mode":"MAINNET","live_deposits":true,"real_payouts":true,"production_go_live_approved":true}'::jsonb
  WHERE key = 'system_mode';
  UPDATE public.platform_settings SET value_json =
    '{"environment":"PRODUCTION","live_deposits_enabled":true,"real_payouts_enabled":true,"go_live_approved":true,"payouts_locked":false}'::jsonb
  WHERE key = 'production_config';

  EXECUTE v_command;
  SELECT count(*) INTO v_count FROM net.http_calls;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Open simulated production gates should enqueue exactly one monitor request';
  END IF;
  SELECT request_headers INTO v_headers FROM net.http_calls ORDER BY id DESC LIMIT 1;
  IF v_headers->>'x-aegis-cron-secret' <> 'test-only-cron-secret' THEN
    RAISE EXCEPTION 'Cron secret was not read from the Vault fixture';
  END IF;

  -- If any broad gate closes again, another schedule tick must be skipped.
  UPDATE public.platform_settings
  SET value_json = value_json || '{"live_deposits":false}'::jsonb
  WHERE key = 'system_mode';
  EXECUTE v_command;
  SELECT count(*) INTO v_count FROM net.http_calls;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Cron enqueued a request after a production gate closed';
  END IF;
END;
$tests$;

SELECT 'guarded monitor cron assertions passed' AS result;
