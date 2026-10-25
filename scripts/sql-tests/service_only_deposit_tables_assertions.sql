-- Must run only against the disposable PostgreSQL fixture.
DO $tests$
DECLARE
  v_table text;
  v_policy_count integer;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'deposit_security_events',
    'deposit_wallet_sweep_items',
    'deposit_wallet_sweeps',
    'deposit_wallets',
    'shasta_test_users'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=v_table AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS must remain enabled on public.%', v_table;
    END IF;

    SELECT count(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname='public'
      AND tablename=v_table
      AND policyname=v_table || '_deny_client_access'
      AND cmd='ALL'
      AND roles @> ARRAY['anon'::name,'authenticated'::name]
      AND coalesce(qual,'')='false'
      AND coalesce(with_check,'')='false';
    IF v_policy_count <> 1 THEN
      RAISE EXCEPTION 'public.% must have exactly the intended deny-all client policy', v_table;
    END IF;

    IF has_table_privilege('anon','public.' || v_table,'SELECT')
       OR has_table_privilege('anon','public.' || v_table,'INSERT')
       OR has_table_privilege('anon','public.' || v_table,'UPDATE')
       OR has_table_privilege('anon','public.' || v_table,'DELETE') THEN
      RAISE EXCEPTION 'anon role retains direct DML access to public.%', v_table;
    END IF;
    IF has_table_privilege('authenticated','public.' || v_table,'SELECT')
       OR has_table_privilege('authenticated','public.' || v_table,'INSERT')
       OR has_table_privilege('authenticated','public.' || v_table,'UPDATE')
       OR has_table_privilege('authenticated','public.' || v_table,'DELETE') THEN
      RAISE EXCEPTION 'authenticated role retains direct DML access to public.%', v_table;
    END IF;

    IF NOT has_table_privilege('service_role','public.' || v_table,'SELECT')
       OR NOT has_table_privilege('service_role','public.' || v_table,'INSERT')
       OR NOT has_table_privilege('service_role','public.' || v_table,'UPDATE')
       OR NOT has_table_privilege('service_role','public.' || v_table,'DELETE') THEN
      RAISE EXCEPTION 'service_role is missing required internal table DML privileges on public.%', v_table;
    END IF;
  END LOOP;

  RAISE NOTICE 'Service-only internal deposit table access assertions passed';
END;
$tests$;

SELECT 'Service-only internal deposit table access assertions: PASS' AS result;
