-- Enable secure Supabase Google/Facebook OAuth signup/linking without requiring a password.
-- Existing email/password signup behavior remains unchanged.
CREATE OR REPLACE FUNCTION public.handle_new_aegispay_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id UUID;
  v_name TEXT;
  v_username TEXT;
  v_username_base TEXT;
  v_username_suffix INTEGER;
  v_referral_code TEXT;
  v_new_referral_code TEXT;
  v_referrer_id UUID;
  v_language TEXT;
  v_is_approved_invite BOOLEAN;
BEGIN
  IF NEW.email IS NULL OR trim(NEW.email) = '' THEN
    RAISE EXCEPTION 'An email address is required';
  END IF;

  v_is_approved_invite :=
    NEW.invited_at IS NOT NULL
    OR COALESCE(NEW.raw_app_meta_data ->> 'aegispay_approved', 'false') = 'true';

  IF v_is_approved_invite THEN
    UPDATE public.users
      SET auth_user_id = NEW.id
      WHERE lower(email) = lower(trim(NEW.email))
        AND auth_user_id IS NULL
        AND upper(status) <> 'DELETED'
      RETURNING id INTO v_profile_id;
    IF v_profile_id IS NOT NULL THEN RETURN NEW; END IF;
  END IF;

  -- A social provider may link only an unclaimed profile when Supabase Auth marks the exact email as confirmed.
  -- Preserve the existing role, status, username, referral data and balance.
  IF lower(COALESCE(NEW.raw_app_meta_data ->> 'provider', '')) IN ('google', 'facebook')
     AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.users
      SET auth_user_id = NEW.id
      WHERE lower(email) = lower(trim(NEW.email))
        AND auth_user_id IS NULL
        AND role = 'USER'
        AND upper(status) <> 'DELETED'
      RETURNING id INTO v_profile_id;
    IF v_profile_id IS NOT NULL THEN RETURN NEW; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE lower(email) = lower(trim(NEW.email))) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'This email already has an AegisPay profile. Contact support to restore access.';
  END IF;

  v_name := left(trim(COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    split_part(NEW.email, '@', 1)
  )), 100);
  IF length(v_name) < 2 THEN RAISE EXCEPTION 'Please provide a valid display name'; END IF;

  v_username := lower(trim(COALESCE(NEW.raw_user_meta_data ->> 'username', '')));
  IF v_username = '' OR NOT v_username ~ '^[a-z0-9_]{3,32}$' THEN
    -- Provider claims are managed by Supabase. On the initial auth.users
    -- insert, email_confirmed_at may not yet be populated even for a Google/Facebook OAuth
    -- flow, so username generation must not depend on that timestamp. Existing-profile
    -- linking above still requires email_confirmed_at to be non-NULL.
    IF lower(COALESCE(NEW.raw_app_meta_data ->> 'provider', '')) IN ('google', 'facebook')
       OR COALESCE(NEW.raw_app_meta_data -> 'providers', '[]'::jsonb) @> '["google"]'::jsonb
       OR COALESCE(NEW.raw_app_meta_data -> 'providers', '[]'::jsonb) @> '["facebook"]'::jsonb THEN
      v_username_base := trim(both '_' from regexp_replace(
        lower(split_part(trim(NEW.email), '@', 1)),
        '[^a-z0-9_]+', '_', 'g'
      ));
      IF length(v_username_base) < 3 THEN
        v_username_base := 'user_' || v_username_base;
      END IF;
      v_username_base := left(v_username_base, 32);
      v_username := v_username_base;
      v_username_suffix := 1;
      WHILE EXISTS (SELECT 1 FROM public.users WHERE lower(username) = v_username) LOOP
        v_username_suffix := v_username_suffix + 1;
        v_username := left(v_username_base, 32 - length('_' || v_username_suffix::text))
          || '_' || v_username_suffix::text;
      END LOOP;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A valid username is required';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE lower(username) = v_username) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'This username is already in use.';
  END IF;

  v_language := lower(COALESCE(NEW.raw_user_meta_data ->> 'preferred_language', 'en'));
  IF v_language NOT IN ('en','ur') THEN v_language := 'en'; END IF;

  v_referral_code := upper(trim(COALESCE(NEW.raw_user_meta_data ->> 'referral_code', '')));
  IF v_referral_code <> '' THEN
    SELECT id INTO v_referrer_id
    FROM public.users
    WHERE referral_code = v_referral_code
      AND role = 'USER'
      AND upper(status) IN ('ACTIVE','NORMAL');
    IF v_referrer_id IS NULL THEN RAISE EXCEPTION 'Referral code is invalid'; END IF;
  END IF;

  LOOP
    v_new_referral_code := 'AG' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.users WHERE referral_code = v_new_referral_code
    );
  END LOOP;

  INSERT INTO public.users (
    name, username, email, role, status, auth_user_id, referral_code,
    referred_by, preferred_language
  ) VALUES (
    v_name, v_username, lower(trim(NEW.email)), 'USER', 'Active', NEW.id,
    v_new_referral_code, v_referrer_id, v_language
  );

  RETURN NEW;
END;
$function$;
