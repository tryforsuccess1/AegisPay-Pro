-- Restore the controlled test signup mode after a demo-data reset.
-- This does not enable real deposits or real payouts.
INSERT INTO public.platform_settings(key, value_json, updated_at)
VALUES (
  'system_mode',
  '{"mode":"TESTNET_DEMO","status":"TEST_MODE","real_payouts":false,"live_deposits":false}'::jsonb,
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value_json = EXCLUDED.value_json,
  updated_at = now();
