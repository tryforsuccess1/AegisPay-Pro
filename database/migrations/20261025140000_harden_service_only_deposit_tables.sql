-- Defense-in-depth for internal deposit/wallet bookkeeping.
-- These tables are accessed by trusted backend Edge Functions only; public and
-- authenticated roles must never receive direct table access. Deny-all policies
-- also protect against accidental grants added in a later migration.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE
  public.deposit_security_events,
  public.deposit_wallet_sweep_items,
  public.deposit_wallet_sweeps,
  public.deposit_wallets,
  public.shasta_test_users
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.deposit_security_events,
  public.deposit_wallet_sweep_items,
  public.deposit_wallet_sweeps,
  public.deposit_wallets,
  public.shasta_test_users
TO service_role;

DROP POLICY IF EXISTS deposit_security_events_deny_client_access ON public.deposit_security_events;
CREATE POLICY deposit_security_events_deny_client_access
  ON public.deposit_security_events FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deposit_wallet_sweep_items_deny_client_access ON public.deposit_wallet_sweep_items;
CREATE POLICY deposit_wallet_sweep_items_deny_client_access
  ON public.deposit_wallet_sweep_items FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deposit_wallet_sweeps_deny_client_access ON public.deposit_wallet_sweeps;
CREATE POLICY deposit_wallet_sweeps_deny_client_access
  ON public.deposit_wallet_sweeps FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deposit_wallets_deny_client_access ON public.deposit_wallets;
CREATE POLICY deposit_wallets_deny_client_access
  ON public.deposit_wallets FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS shasta_test_users_deny_client_access ON public.shasta_test_users;
CREATE POLICY shasta_test_users_deny_client_access
  ON public.shasta_test_users FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.deposit_security_events IS
  'Internal security-event evidence. Service-role-only; client access is denied by grants and RLS policy.';
COMMENT ON TABLE public.deposit_wallet_sweep_items IS
  'Internal sweep-to-deposit evidence mapping. Service-role-only; contains transaction association details, not client-facing data.';
COMMENT ON TABLE public.deposit_wallet_sweeps IS
  'Internal TRON sweep journal. Service-role-only; signed transaction payloads are sensitive transfer capabilities.';
COMMENT ON TABLE public.deposit_wallets IS
  'Per-user TRON HD deposit address mapping. Service-role-only; client applications must request addresses through the authenticated Edge Function.';
COMMENT ON TABLE public.shasta_test_users IS
  'Testnet-only account allowlist. Service-role-only; must never be directly editable by clients.';

COMMIT;
