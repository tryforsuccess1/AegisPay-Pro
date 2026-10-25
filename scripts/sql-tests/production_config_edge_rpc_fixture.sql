-- Disposable PostgreSQL fixture for the restricted production configuration Edge RPC.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'CREATE ROLE anon NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'CREATE ROLE authenticated NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'CREATE ROLE service_role NOLOGIN'; END IF;
END;
$roles$;

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  auth_user_id uuid UNIQUE NOT NULL,
  role text NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.platform_settings (
  key text PRIMARY KEY,
  value_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL,
  payout_txid text
);

CREATE TABLE public.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  event_type text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.app_runtime_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $fn$
  SELECT COALESCE((ps.value_json->>'enabled')::boolean, false)
    FROM public.platform_settings AS ps
   WHERE ps.key = 'app_runtime';
$fn$;

INSERT INTO public.users(id, auth_user_id, role, status) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'MASTER ADMIN', 'ACTIVE'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'USER', 'ACTIVE'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-3333-4333-8333-333333333333', 'MASTER ADMIN', 'SUSPENDED');

INSERT INTO public.platform_settings(key, value_json) VALUES
  ('system_mode', '{"mode":"MAINNET","status":"PRE_PRODUCTION_PAYOUTS_LOCKED","live_deposits":false,"real_payouts":false,"production_go_live_approved":false}'),
  ('deposit_rules', jsonb_build_object('network','TRON MAINNET','token_contract','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t','receiving_address','T222222222222222222222222222222222')),
  ('production_config', '{"environment":"PRE_PRODUCTION","live_deposits_enabled":false,"real_payouts_enabled":false,"go_live_approved":false,"payouts_locked":true}'),
  ('app_runtime', '{"enabled":true}');
