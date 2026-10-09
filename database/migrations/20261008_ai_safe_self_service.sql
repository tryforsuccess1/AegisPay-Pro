-- Safe AI client self-service: separate editable display name from legal/profile name.
-- AI may update display_name for the authenticated USER only.
-- Legal/profile name remains protected for KYC/identity integrity.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE OR REPLACE FUNCTION public.ai_update_display_name(p_name TEXT)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user public.users;
  v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication is required';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE auth_user_id = auth.uid()
  FOR UPDATE;

  IF v_user.id IS NULL OR v_user.role <> 'USER' THEN
    RAISE EXCEPTION 'Client profile not found';
  END IF;

  IF upper(COALESCE(v_user.status,'')) IN ('BLOCKED','SUSPENDED','DELETED') THEN
    RAISE EXCEPTION 'This account cannot change its display name';
  END IF;

  v_name := regexp_replace(trim(COALESCE(p_name,'')), '\s+', ' ', 'g');

  IF length(v_name) < 2 OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'Display name must be between 2 and 60 characters';
  END IF;

  UPDATE public.users
  SET display_name = v_name
  WHERE id = v_user.id
  RETURNING * INTO v_user;

  INSERT INTO public.account_ledger(
    user_id, entry_type, amount, description, reference_id, metadata
  )
  VALUES(
    v_user.id, 'PROFILE_UPDATE', 0,
    'Client display name updated by AegisPay AI',
    v_user.id::TEXT,
    jsonb_build_object('field','display_name')
  );

  RETURN v_user;
END;
$function$;

REVOKE ALL ON FUNCTION public.ai_update_display_name(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_update_display_name(TEXT) TO authenticated;
