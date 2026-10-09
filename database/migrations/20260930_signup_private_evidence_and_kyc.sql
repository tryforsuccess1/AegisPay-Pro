-- Public signup, private evidence handling, and withdrawal KYC gate.
-- Demo profiles are anonymized in place so related audit/withdrawal history remains intact.
BEGIN;

DO $$
DECLARE v_unlinked_count INTEGER;
BEGIN
  SELECT count(*) INTO v_unlinked_count FROM public.users WHERE auth_user_id IS NULL;
  IF v_unlinked_count <> 6 THEN
    RAISE EXCEPTION 'Expected six unlinked demo profiles before anonymization; found %', v_unlinked_count;
  END IF;
END $$;

UPDATE public.users
SET name = 'Removed account',
    email = 'removed+' || replace(id::text, '-', '') || '@example.invalid',
    status = 'DELETED',
    role = 'USER',
    auth_user_id = NULL,
    destination_address = NULL,
    withdrawal_wallet_owner_name = NULL,
    referral_code = NULL,
    referred_by = NULL,
    current_platform_balance = 0,
    principal_balance = 0,
    profit_balance = 0,
    manual_credit_balance = 0,
    withdrawal_held = 0,
    first_deposit_done = FALSE,
    selected_tier_id = NULL,
    password_reset_at = NULL,
    frozen_until = NULL
WHERE auth_user_id IS NULL;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_preferred_language_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_preferred_language_check
      CHECK (preferred_language IN ('en','ur'));
  END IF;
END $$;

-- Only server-issued invitations may claim an existing profile. Public signup
-- always gets a new USER profile; browser-supplied metadata can never set a role.
CREATE OR REPLACE FUNCTION public.handle_new_aegispay_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id UUID;
  v_name TEXT;
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
    IF v_profile_id IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE lower(email) = lower(trim(NEW.email))) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'This email already has an AegisPay profile. Contact support to restore access.';
  END IF;

  v_name := left(trim(COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    split_part(NEW.email, '@', 1)
  )), 100);
  IF length(v_name) < 2 THEN
    RAISE EXCEPTION 'Please provide a valid display name';
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
    IF v_referrer_id IS NULL THEN
      RAISE EXCEPTION 'Referral code is invalid';
    END IF;
  END IF;

  LOOP
    v_new_referral_code := 'AG' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.users WHERE referral_code = v_new_referral_code
    );
  END LOOP;

  INSERT INTO public.users (
    name, email, role, status, auth_user_id, referral_code,
    referred_by, preferred_language
  ) VALUES (
    v_name,
    lower(trim(NEW.email)),
    'USER',
    'Active',
    NEW.id,
    v_new_referral_code,
    v_referrer_id,
    v_language
  );

  RETURN NEW;
END;
$function$;

-- Ensure the Auth user trigger is installed exactly once.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND t.tgfoid = 'public.handle_new_aegispay_auth_user()'::regprocedure
      AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_aegispay_auth_user();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_my_language(p_language TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_language TEXT := lower(trim(COALESCE(p_language, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required';
  END IF;
  IF v_language NOT IN ('en','ur') THEN
    RAISE EXCEPTION 'Unsupported language';
  END IF;
  UPDATE public.users SET preferred_language = v_language WHERE auth_user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'AegisPay profile not found'; END IF;
  RETURN v_language;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_my_language(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_language(TEXT) TO authenticated;

ALTER TABLE public.deposit_submissions
  ADD COLUMN IF NOT EXISTS ai_review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN IF NOT EXISTS ai_review_reason TEXT,
  ADD COLUMN IF NOT EXISTS ai_reviewed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deposit_submissions_ai_review_status_check'
      AND conrelid = 'public.deposit_submissions'::regclass
  ) THEN
    ALTER TABLE public.deposit_submissions
      ADD CONSTRAINT deposit_submissions_ai_review_status_check
      CHECK (ai_review_status IN ('PENDING_REVIEW','APPROVED','MANUAL_APPROVED','REJECTED','MANUAL_REVIEW','UNAVAILABLE'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('CNIC','PASSPORT')),
  front_storage_path TEXT NOT NULL,
  back_storage_path TEXT,
  processing_consent_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('PENDING_REVIEW','VERIFIED','REJECTED','MANUAL_REVIEW')),
  ai_review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (ai_review_status IN ('PENDING_REVIEW','APPROVED','MANUAL_APPROVED','REJECTED','MANUAL_REVIEW','UNAVAILABLE')),
  ai_confidence NUMERIC(4,3) CHECK (ai_confidence BETWEEN 0 AND 1),
  review_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS kyc_verifications_user_submitted_idx
  ON public.kyc_verifications(user_id, submitted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS kyc_one_in_progress_record_per_user
  ON public.kyc_verifications(user_id)
  WHERE status IN ('PENDING_REVIEW','MANUAL_REVIEW');
CREATE UNIQUE INDEX IF NOT EXISTS kyc_one_verified_record_per_user
  ON public.kyc_verifications(user_id) WHERE status = 'VERIFIED';

ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kyc_self_or_master_read ON public.kyc_verifications;
CREATE POLICY kyc_self_or_master_read ON public.kyc_verifications
  FOR SELECT TO authenticated
  USING (user_id = public.current_app_user_id() OR public.current_app_role() = 'MASTER ADMIN');

GRANT SELECT ON public.kyc_verifications TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.kyc_verifications FROM PUBLIC, anon, authenticated;

-- Evidence is private and owner-scoped. The first path segment must be the
-- Supabase Auth user ID. Admin review obtains short-lived signed URLs server-side.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('private-verification', 'private-verification', FALSE, 10485760,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS verification_upload_own ON storage.objects;
CREATE POLICY verification_upload_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'private-verification'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS verification_read_own_or_master ON storage.objects;
CREATE POLICY verification_read_own_or_master ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'private-verification'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.current_app_role() = 'MASTER ADMIN'
    )
  );

-- Client mutations go through authenticated RPCs or Edge Functions so balances,
-- approval fields, and review statuses cannot be supplied by the browser.
DROP POLICY IF EXISTS users_master_all ON public.users;
DROP POLICY IF EXISTS users_self_update ON public.users;
DROP POLICY IF EXISTS deposits_user_insert ON public.deposit_submissions;
DROP POLICY IF EXISTS deposits_master_write ON public.deposit_submissions;
DROP POLICY IF EXISTS withdrawals_user_insert ON public.withdrawal_requests;
DROP POLICY IF EXISTS withdrawals_master_update ON public.withdrawal_requests;

REVOKE INSERT, UPDATE, DELETE ON public.users FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.deposit_submissions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.withdrawal_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.users, public.deposit_submissions, public.withdrawal_requests TO authenticated;

REVOKE ALL ON FUNCTION public.request_withdrawal(NUMERIC, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount NUMERIC)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_balance NUMERIC;
  v_withdrawal_held NUMERIC;
  v_pending NUMERIC;
  v_wallet TEXT;
  v_status TEXT;
  v_request_id UUID;
  v_fee_rate NUMERIC := 0.10;
  v_fee NUMERIC;
  v_net NUMERIC;
  v_risk NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required';
  END IF;

  v_user_id := public.current_app_user_id();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AegisPay profile not found'; END IF;

  SELECT current_platform_balance, withdrawal_held, destination_address, status
    INTO v_balance, v_withdrawal_held, v_wallet, v_status
    FROM public.users WHERE id = v_user_id FOR UPDATE;

  IF upper(COALESCE(v_status, '')) IN ('BLOCKED','SUSPENDED','DELETED') THEN
    RAISE EXCEPTION 'This account is not allowed to request withdrawals';
  END IF;
  IF p_amount IS NULL OR p_amount < 50 THEN RAISE EXCEPTION 'Minimum withdrawal is $50'; END IF;
  IF COALESCE(v_wallet, '') = '' THEN RAISE EXCEPTION 'Link a withdrawal wallet before requesting a withdrawal'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.kyc_verifications
    WHERE user_id = v_user_id AND status = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION 'Complete KYC verification before requesting a withdrawal';
  END IF;

  SELECT COALESCE((value_json ->> 'fee_rate')::NUMERIC, 0.10)
    INTO v_fee_rate FROM public.platform_settings WHERE key = 'withdrawal_rules';
  v_fee_rate := LEAST(0.25, GREATEST(0, COALESCE(v_fee_rate, 0.10)));
  v_fee := round(p_amount * v_fee_rate, 2);
  v_net := p_amount - v_fee;
  v_risk := round(least(0.35, greatest(0.02, p_amount / 5000)), 4);

  SELECT COALESCE(sum(amount), 0) INTO v_pending
    FROM public.withdrawal_requests
    WHERE user_id = v_user_id
      AND status IN ('PENDING_APPROVAL','APPROVED','PROCESSING');

  IF p_amount > COALESCE(v_balance, 0) - GREATEST(COALESCE(v_withdrawal_held,0), v_pending) THEN
    RAISE EXCEPTION 'Withdrawal exceeds available balance';
  END IF;

  INSERT INTO public.withdrawal_requests(user_id, amount, destination_address, ai_risk_score, fee_amount, net_amount)
  VALUES(v_user_id, p_amount, v_wallet, v_risk, v_fee, v_net)
  RETURNING id INTO v_request_id;

  UPDATE public.users
    SET withdrawal_held = GREATEST(COALESCE(withdrawal_held,0), v_pending) + p_amount
    WHERE id = v_user_id;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.request_withdrawal(NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.link_withdrawal_wallet(p_address TEXT, p_owner_name TEXT)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_user public.users;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required';
  END IF;
  SELECT * INTO v_user FROM public.users
    WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF v_user.id IS NULL OR v_user.role <> 'USER' THEN
    RAISE EXCEPTION 'Client profile not found';
  END IF;
  IF upper(COALESCE(v_user.status,'')) IN ('BLOCKED','SUSPENDED','DELETED') THEN
    RAISE EXCEPTION 'This account cannot link a withdrawal wallet';
  END IF;
  IF COALESCE(v_user.destination_address,'') <> '' THEN
    RAISE EXCEPTION 'Withdrawal wallet is already linked';
  END IF;
  IF trim(COALESCE(p_address,'')) !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
    RAISE EXCEPTION 'Enter a valid TRON wallet address';
  END IF;
  IF lower(trim(COALESCE(p_owner_name,''))) <> lower(trim(v_user.name)) THEN
    RAISE EXCEPTION 'Wallet owner name must match the profile name';
  END IF;
  UPDATE public.users
    SET destination_address = trim(p_address), withdrawal_wallet_owner_name = trim(p_owner_name)
    WHERE id = v_user.id RETURNING * INTO v_user;
  RETURN v_user;
END;
$function$;

REVOKE ALL ON FUNCTION public.link_withdrawal_wallet(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_withdrawal_wallet(TEXT, TEXT) TO authenticated;

-- Defense in depth: a service-role monitor can never credit a deposit unless
-- the AI evidence check or a documented human review explicitly approved it.
CREATE OR REPLACE FUNCTION public.require_deposit_evidence_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'VERIFIED'
     AND OLD.status <> 'VERIFIED'
     AND NEW.ai_review_status NOT IN ('APPROVED','MANUAL_APPROVED') THEN
    RAISE EXCEPTION 'Deposit evidence must be approved before a balance credit';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS require_deposit_evidence_review ON public.deposit_submissions;
CREATE TRIGGER require_deposit_evidence_review
  BEFORE UPDATE OF status ON public.deposit_submissions
  FOR EACH ROW EXECUTE FUNCTION public.require_deposit_evidence_review();

-- Keep the live project in test-only mode. A real receive address and mainnet
-- transfer path must be explicitly configured by the operator before launch.
UPDATE public.platform_settings
SET value_json = value_json || jsonb_build_object(
  'mode', 'TESTNET_DEMO',
  'status', 'TEST_MODE',
  'real_payouts', false,
  'live_deposits', false
), updated_at = now()
WHERE key = 'system_mode';

UPDATE public.platform_settings
SET value_json = value_json || jsonb_build_object(
  'network', 'TRON TESTNET',
  'token', 'USDT',
  'token_standard', 'TRC20',
  'token_contract', 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
  'live_deposits', false
), updated_at = now()
WHERE key = 'deposit_rules';

COMMIT;
