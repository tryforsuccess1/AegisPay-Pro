-- Phase 3 completion: controlled production configuration, audit trail and server-side safety gates.
CREATE OR REPLACE FUNCTION public.get_production_readiness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role text; v_status text; v_system jsonb:='{}'; v_deposit jsonb:='{}'; v_prod jsonb:='{}'; v_runtime boolean:=false;
v_address text:=''; v_network text:=''; v_mode text:=''; v_live_deposits boolean:=false; v_real_payouts boolean:=false; v_go_live boolean:=false;
v_payouts_locked boolean:=true; v_cfg_live_deposits boolean:=false; v_cfg_real_payouts boolean:=false; v_cfg_go_live boolean:=false;
BEGIN
IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication is required'; END IF;
SELECT role,status INTO v_role,v_status FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
IF v_role<>'MASTER ADMIN' OR upper(COALESCE(v_status,'')) NOT IN ('ACTIVE','NORMAL') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active Master Admin access is required';
END IF;
SELECT COALESCE(value_json,'{}'::jsonb) INTO v_system FROM public.platform_settings WHERE key='system_mode';
SELECT COALESCE(value_json,'{}'::jsonb) INTO v_deposit FROM public.platform_settings WHERE key='deposit_rules';
SELECT COALESCE(value_json,'{}'::jsonb) INTO v_prod FROM public.platform_settings WHERE key='production_config';
v_mode:=upper(COALESCE(v_system->>'mode','')); v_network:=upper(COALESCE(v_deposit->>'network','')); v_address:=trim(COALESCE(v_deposit->>'receiving_address',''));
v_live_deposits:=COALESCE((v_system->>'live_deposits')::boolean,false); v_real_payouts:=COALESCE((v_system->>'real_payouts')::boolean,false); v_go_live:=COALESCE((v_system->>'production_go_live_approved')::boolean,false);
v_payouts_locked:=COALESCE((v_prod->>'payouts_locked')::boolean,true); v_cfg_live_deposits:=COALESCE((v_prod->>'live_deposits_enabled')::boolean,false);
v_cfg_real_payouts:=COALESCE((v_prod->>'real_payouts_enabled')::boolean,false); v_cfg_go_live:=COALESCE((v_prod->>'go_live_approved')::boolean,false);
BEGIN v_runtime:=public.app_runtime_enabled(); EXCEPTION WHEN OTHERS THEN v_runtime:=false; END;
RETURN jsonb_build_object(
'environment',COALESCE(v_prod->>'environment','PRE_PRODUCTION'),'system_mode',v_mode,'system_status',COALESCE(v_system->>'status',''),'network',v_network,
'receiving_address_configured',(v_address<>''),'live_deposits',v_live_deposits,'real_payouts',v_real_payouts,'production_go_live_approved',v_go_live,'payouts_locked',v_payouts_locked,
'production_config_live_deposits',v_cfg_live_deposits,'production_config_real_payouts',v_cfg_real_payouts,'production_config_go_live_approved',v_cfg_go_live,'runtime_enabled',v_runtime,
'configuration_consistent',(v_live_deposits=v_cfg_live_deposits AND v_real_payouts=v_cfg_real_payouts AND v_go_live=v_cfg_go_live),
'mainnet_base_config_ok',(v_mode='MAINNET' AND v_network='TRON MAINNET' AND v_address<>''),
'mainnet_deposit_gate_ok',(v_mode='MAINNET' AND v_network='TRON MAINNET' AND v_address<>'' AND v_live_deposits),
'mainnet_payout_gate_ok',(v_mode='MAINNET' AND v_network='TRON MAINNET' AND v_address<>'' AND v_real_payouts AND v_go_live AND NOT v_payouts_locked AND v_runtime),
'server_side_secrets_required',true,'cron_secret_required_for_monitoring',true);
END; $$;

CREATE OR REPLACE FUNCTION public.set_production_config(
p_environment text,p_live_deposits_enabled boolean,p_real_payouts_enabled boolean,p_go_live_approved boolean,p_payouts_locked boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid; v_role text; v_status text; v_env text:=upper(trim(COALESCE(p_environment,'')));
v_system jsonb:='{}'; v_deposit jsonb:='{}'; v_addr text:=''; v_network text:=''; v_mode text:=''; v_runtime boolean:=false; v_mainnet_ready boolean:=false;
BEGIN
IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication is required'; END IF;
SELECT id,role,status INTO v_actor,v_role,v_status FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1;
IF v_role<>'MASTER ADMIN' OR upper(COALESCE(v_status,'')) NOT IN ('ACTIVE','NORMAL') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active Master Admin access is required'; END IF;
IF v_env NOT IN ('PRE_PRODUCTION','PRODUCTION') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Environment must be PRE_PRODUCTION or PRODUCTION'; END IF;
SELECT COALESCE(value_json,'{}'::jsonb) INTO v_system FROM public.platform_settings WHERE key='system_mode';
SELECT COALESCE(value_json,'{}'::jsonb) INTO v_deposit FROM public.platform_settings WHERE key='deposit_rules';
v_addr:=trim(COALESCE(v_deposit->>'receiving_address','')); v_network:=upper(COALESCE(v_deposit->>'network','')); v_mode:=upper(COALESCE(v_system->>'mode',''));
v_mainnet_ready:=(v_mode='MAINNET' AND v_network='TRON MAINNET' AND v_addr ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$');
BEGIN v_runtime:=public.app_runtime_enabled(); EXCEPTION WHEN OTHERS THEN v_runtime:=false; END;
IF v_env='PRE_PRODUCTION' AND p_real_payouts_enabled THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Real payouts cannot be enabled in PRE_PRODUCTION'; END IF;
IF p_real_payouts_enabled AND NOT p_go_live_approved THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Go-Live approval is required before real payouts can be enabled'; END IF;
IF p_real_payouts_enabled AND p_payouts_locked THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Payout lock must be OPEN before real payouts can be enabled'; END IF;
IF p_real_payouts_enabled AND NOT v_mainnet_ready THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MAINNET/TRON MAINNET and a valid receiving address are required before real payouts'; END IF;
IF p_live_deposits_enabled AND v_env='PRODUCTION' AND NOT v_mainnet_ready THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MAINNET/TRON MAINNET and a valid receiving address are required before live deposits'; END IF;
IF p_real_payouts_enabled AND NOT v_runtime THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='AegisPay runtime must be enabled before real payouts'; END IF;
INSERT INTO public.platform_settings(key,value_json,updated_at) VALUES(
'production_config',jsonb_build_object('environment',v_env,'go_live_approved',COALESCE(p_go_live_approved,false),'real_payouts_enabled',COALESCE(p_real_payouts_enabled,false),
'live_deposits_enabled',COALESCE(p_live_deposits_enabled,false),'payouts_locked',COALESCE(p_payouts_locked,true),'configured_by',v_actor,'configured_at',now()),now())
ON CONFLICT(key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=now();
UPDATE public.platform_settings SET value_json=value_json||jsonb_build_object('production_go_live_approved',COALESCE(p_go_live_approved,false),'real_payouts',COALESCE(p_real_payouts_enabled,false),'live_deposits',COALESCE(p_live_deposits_enabled,false)),updated_at=now() WHERE key='system_mode';
INSERT INTO public.audit_events(actor_user_id,event_type,description) VALUES(v_actor,'PRODUCTION_CONFIG_UPDATED',
'Phase 3 production configuration updated: environment='||v_env||', live_deposits='||COALESCE(p_live_deposits_enabled,false)::text||
', real_payouts='||COALESCE(p_real_payouts_enabled,false)::text||', go_live_approved='||COALESCE(p_go_live_approved,false)::text||', payouts_locked='||COALESCE(p_payouts_locked,true)::text);
RETURN public.get_production_readiness();
END; $$;
REVOKE ALL ON FUNCTION public.set_production_config(text,boolean,boolean,boolean,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_production_config(text,boolean,boolean,boolean,boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_production_config(text,boolean,boolean,boolean,boolean) TO authenticated;
COMMENT ON FUNCTION public.set_production_config(text,boolean,boolean,boolean,boolean) IS 'Master Admin only Phase 3 production controls with server-side safety gates and audit logging.';
COMMENT ON FUNCTION public.get_production_readiness() IS 'Master Admin only Phase 3 production readiness snapshot; no secret values are returned.';
