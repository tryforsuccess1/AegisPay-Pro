-- Restrict profile claiming to verified, pre-approved Auth identities.
CREATE OR REPLACE FUNCTION public.claim_aegispay_profile()
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile public.users;
  v_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
  v_invited_at TIMESTAMPTZ;
  v_app_metadata JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required';
  END IF;

  SELECT u.email, u.email_confirmed_at, u.invited_at, u.raw_app_meta_data
  INTO v_email, v_email_confirmed_at, v_invited_at, v_app_metadata
  FROM auth.users AS u
  WHERE u.id = auth.uid();

  IF v_email IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated Supabase user not found';
  END IF;
  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Verify your email before claiming an AegisPay profile';
  END IF;

  SELECT * INTO v_profile
  FROM public.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_profile.id IS NOT NULL THEN
    RETURN v_profile;
  END IF;

  IF v_invited_at IS NULL
     AND COALESCE(v_app_metadata ->> 'aegispay_approved', 'false') <> 'true' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This Auth account has not been approved for AegisPay access';
  END IF;

  UPDATE public.users
  SET auth_user_id = auth.uid()
  WHERE lower(email) = lower(v_email)
    AND auth_user_id IS NULL
  RETURNING * INTO v_profile;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'No unclaimed AegisPay profile is approved for this email';
  END IF;

  RETURN v_profile;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_aegispay_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_aegispay_profile() TO authenticated;
