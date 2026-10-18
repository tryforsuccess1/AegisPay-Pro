-- Must run only against the disposable PostgreSQL fixture.
DO $tests$
BEGIN
  IF has_function_privilege('authenticated','public.ai_update_display_name(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Legacy display-name RPC remains executable by authenticated';
  END IF;
  IF has_function_privilege('authenticated','public.finalize_withdrawal(uuid,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Legacy withdrawal-finalization RPC remains executable by authenticated';
  END IF;
  IF has_function_privilege('authenticated','public.get_production_readiness()','EXECUTE') THEN
    RAISE EXCEPTION 'Privileged production-readiness helper remains executable by authenticated';
  END IF;
  IF has_function_privilege('authenticated','public.master_admin_adjust_balance(uuid,numeric,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Legacy balance-adjustment RPC remains executable by authenticated';
  END IF;
  IF has_function_privilege('authenticated','public.set_production_config(text,boolean,boolean,boolean,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Privileged production configuration RPC remains executable by authenticated';
  END IF;

  IF has_function_privilege('anon','public.ai_update_display_name(text)','EXECUTE')
     OR has_function_privilege('anon','public.finalize_withdrawal(uuid,boolean)','EXECUTE')
     OR has_function_privilege('anon','public.get_production_readiness()','EXECUTE')
     OR has_function_privilege('anon','public.master_admin_adjust_balance(uuid,numeric,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.set_production_config(text,boolean,boolean,boolean,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous execution must remain denied for privileged RPCs';
  END IF;

  -- Trusted backend permissions are preserved where present in production.
  IF NOT has_function_privilege('service_role','public.ai_update_display_name(text)','EXECUTE')
     OR has_function_privilege('service_role','public.finalize_withdrawal(uuid,boolean)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.get_production_readiness()','EXECUTE')
     OR NOT has_function_privilege('service_role','public.master_admin_adjust_balance(uuid,numeric,text,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.set_production_config(text,boolean,boolean,boolean,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Trusted service-role grants changed unexpectedly';
  END IF;

  -- Do not revoke helper calls that existing RLS policies depend on.
  IF NOT has_function_privilege('authenticated','public.current_app_role()','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.current_app_user_id()','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated RLS identity helper grants must be preserved';
  END IF;

  RAISE NOTICE 'Legacy SECURITY DEFINER RPC permission assertions passed';
END;
$tests$;
