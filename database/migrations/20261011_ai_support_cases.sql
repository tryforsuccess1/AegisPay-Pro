-- AegisPay AI support cases. Client records are only read or changed by the authenticated Edge Function with service-role access.
CREATE TABLE IF NOT EXISTS public.ai_support_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
 auth_user_id uuid,
 category text NOT NULL DEFAULT 'GENERAL',
 subject text NOT NULL,
 user_message text NOT NULL,
 ai_answer text,
 status text NOT NULL DEFAULT 'OPEN',
 resolution text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
 CONSTRAINT ai_support_cases_status_check CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
 CONSTRAINT ai_support_cases_category_check CHECK (category IN ('GENERAL','TECHNICAL','ACCOUNT','DEPOSIT','WITHDRAWAL','KYC','SHOP','SECURITY'))
);
CREATE INDEX IF NOT EXISTS ai_support_cases_status_created_idx ON public.ai_support_cases (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_support_cases_user_created_idx ON public.ai_support_cases (user_id, created_at DESC);
ALTER TABLE public.ai_support_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_support_cases FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_support_cases TO service_role;

-- This service-role-only helper requires the Edge Function to authenticate the current user and
-- pass that profile's own ID. It can change display_name only, never the legal/KYC name.
CREATE OR REPLACE FUNCTION public.ai_update_display_name_for_user(p_user_id uuid, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_user public.users; v_name text;
BEGIN
 IF p_user_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A client profile is required'; END IF;
 SELECT * INTO v_user FROM public.users WHERE id=p_user_id FOR UPDATE;
 IF v_user.id IS NULL OR v_user.role <> 'USER' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Client profile not found'; END IF;
 IF upper(COALESCE(v_user.status,'')) NOT IN ('ACTIVE','NORMAL') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='This account cannot change its display name'; END IF;
 v_name := regexp_replace(trim(COALESCE(p_name,'')), '\s+', ' ', 'g');
 IF length(v_name) < 2 OR length(v_name) > 60 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Display name must be between 2 and 60 characters'; END IF;
 UPDATE public.users SET display_name=v_name WHERE id=v_user.id;
 INSERT INTO public.account_ledger(user_id,entry_type,amount,description,reference_id,metadata)
 VALUES(v_user.id,'PROFILE_UPDATE',0,'Client display name updated by AegisPay AI',v_user.id::text,jsonb_build_object('field','display_name','new_value',v_name));
 INSERT INTO public.audit_events(actor_user_id,target_user_id,event_type,description,reference_id)
 VALUES(NULL,v_user.id,'AI_DISPLAY_NAME_UPDATED','AegisPay AI updated the client-facing display name. Legal/profile name was not changed.',v_user.id::text);
 RETURN jsonb_build_object('display_name',v_name);
END;
$function$;
REVOKE ALL ON FUNCTION public.ai_update_display_name_for_user(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_update_display_name_for_user(uuid,text) TO service_role;
