DO $tests$
DECLARE
  v_count integer;
  v_qual text;
  v_check text;
  v_permissive text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.ai_support_messages'::regclass) THEN
    RAISE EXCEPTION 'RLS must remain enabled on ai_support_messages';
  END IF;
  IF has_table_privilege('anon','public.ai_support_messages','SELECT')
     OR has_table_privilege('authenticated','public.ai_support_messages','SELECT')
     OR has_table_privilege('anon','public.ai_support_messages','INSERT')
     OR has_table_privilege('authenticated','public.ai_support_messages','INSERT') THEN
    RAISE EXCEPTION 'Public client roles must not have direct table privileges';
  END IF;
  SELECT count(*), max(qual), max(with_check), max(permissive)
    INTO v_count, v_qual, v_check, v_permissive
    FROM pg_policies
   WHERE schemaname='public'
     AND tablename='ai_support_messages'
     AND policyname='ai_support_messages_deny_client_access'
     AND roles @> ARRAY['anon','authenticated']::name[];
  IF v_count<>1 OR v_qual<>'false' OR v_check<>'false' OR v_permissive<>'RESTRICTIVE' THEN
    RAISE EXCEPTION 'Explicit deny policy for anon/authenticated is missing or too permissive';
  END IF;
  IF NOT has_table_privilege('service_role','public.ai_support_messages','SELECT')
     OR NOT has_table_privilege('service_role','public.ai_support_messages','INSERT') THEN
    RAISE EXCEPTION 'Expected service-role access must remain available for the Edge Function';
  END IF;
  RAISE NOTICE 'AI support message least-privilege assertions passed';
END;
$tests$;
