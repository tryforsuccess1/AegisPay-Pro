BEGIN;

-- One server-owned switch controls all client activity. Missing row means ON
-- so this migration cannot accidentally pause the app during deployment.
CREATE OR REPLACE FUNCTION public.app_runtime_enabled()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT (value_json ->> 'enabled')::BOOLEAN
     FROM public.platform_settings WHERE key = 'app_runtime'),
    TRUE
  );
$function$;
REVOKE ALL ON FUNCTION public.app_runtime_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_runtime_enabled() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_app_runtime_enabled(p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role TEXT;
  v_status TEXT;
  v_value JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required';
  END IF;
  SELECT role, status INTO v_role, v_status
  FROM public.users WHERE auth_user_id = auth.uid();
  IF v_role <> 'MASTER ADMIN' OR upper(COALESCE(v_status, '')) NOT IN ('ACTIVE','NORMAL') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active Master Admin access is required';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'App enabled state must be true or false';
  END IF;

  v_value := jsonb_build_object(
    'enabled', p_enabled,
    'updated_at', clock_timestamp(),
    'updated_by', auth.uid()
  );
  INSERT INTO public.platform_settings(key, value_json, updated_at)
  VALUES ('app_runtime', v_value, clock_timestamp())
  ON CONFLICT (key) DO UPDATE
    SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at;
  RETURN v_value;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_app_runtime_enabled(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_app_runtime_enabled(BOOLEAN) TO authenticated;

-- Existing Master Admin sessions remain able to reach the control surface so
-- the switch can be turned back on; client sessions cannot claim/load data.
CREATE OR REPLACE FUNCTION public.claim_aegispay_profile()
RETURNS public.users
LANGUAGE PLPGSQL
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
  FROM auth.users AS u WHERE u.id = auth.uid();
  IF v_email IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated Supabase user not found';
  END IF;
  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Verify your email before claiming an AegisPay profile';
  END IF;
  SELECT * INTO v_profile FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_profile.id IS NOT NULL THEN
    IF v_profile.role <> 'MASTER ADMIN' AND NOT public.app_runtime_enabled() THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AegisPay is paused by Master Admin';
    END IF;
    RETURN v_profile;
  END IF;
  IF NOT public.app_runtime_enabled() THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AegisPay is paused by Master Admin';
  END IF;
  IF v_invited_at IS NULL
     AND COALESCE(v_app_metadata ->> 'aegispay_approved', 'false') <> 'true' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This Auth account has not been approved for AegisPay access';
  END IF;
  UPDATE public.users SET auth_user_id = auth.uid()
  WHERE lower(email) = lower(v_email) AND auth_user_id IS NULL
  RETURNING * INTO v_profile;
  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'No unclaimed AegisPay profile is approved for this email';
  END IF;
  RETURN v_profile;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_aegispay_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_aegispay_profile() TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_app_runtime_mutations()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Trusted server functions may settle an in-flight operation or recover a
  -- payout safely; those functions separately enforce the runtime switch.
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'platform_settings' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.key = 'app_runtime' AND public.current_app_role() = 'MASTER ADMIN' THEN
        RETURN NEW;
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.key = 'app_runtime' AND NEW.key = 'app_runtime'
         AND public.current_app_role() = 'MASTER ADMIN' THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF public.app_runtime_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AegisPay is paused by Master Admin';
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_app_runtime_mutations() FROM PUBLIC, anon, authenticated;

DO $block$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'users','deposit_submissions','withdrawal_requests','kyc_verifications',
    'account_ledger','tasks','cycle_runs','referrals','notifications',
    'admin_adjustments','shop_offers'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS app_runtime_guard ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER app_runtime_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_app_runtime_mutations()',
      v_table
    );
  END LOOP;
END;
$block$;
DROP TRIGGER IF EXISTS app_runtime_guard ON public.platform_settings;
CREATE TRIGGER app_runtime_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.platform_settings
FOR EACH ROW EXECUTE FUNCTION public.guard_app_runtime_mutations();

-- Authenticated users cannot use direct REST reads while paused; the Master
-- Admin remains able to sign in and use the dedicated resume control.
DROP POLICY IF EXISTS users_self_select ON public.users;
CREATE POLICY users_self_select ON public.users FOR SELECT TO authenticated
USING ((auth_user_id = (SELECT auth.uid()) AND public.app_runtime_enabled())
       OR public.current_app_role() = 'MASTER ADMIN');

DROP POLICY IF EXISTS deposits_user_read ON public.deposit_submissions;
CREATE POLICY deposits_user_read ON public.deposit_submissions FOR SELECT TO public
USING ((user_id = public.current_app_user_id() AND public.app_runtime_enabled())
       OR public.current_app_role() = 'MASTER ADMIN');

DROP POLICY IF EXISTS withdrawals_user_read ON public.withdrawal_requests;
CREATE POLICY withdrawals_user_read ON public.withdrawal_requests FOR SELECT TO public
USING ((user_id = public.current_app_user_id() AND public.app_runtime_enabled())
       OR public.current_app_role() = 'MASTER ADMIN');

DROP POLICY IF EXISTS kyc_self_or_master_read ON public.kyc_verifications;
CREATE POLICY kyc_self_or_master_read ON public.kyc_verifications FOR SELECT TO authenticated
USING ((user_id = public.current_app_user_id() AND public.app_runtime_enabled())
       OR public.current_app_role() = 'MASTER ADMIN');

DROP POLICY IF EXISTS ledger_user_read ON public.account_ledger;
CREATE POLICY ledger_user_read ON public.account_ledger FOR SELECT TO public
USING ((user_id = public.current_app_user_id() AND public.app_runtime_enabled())
       OR public.current_app_role() = 'MASTER ADMIN');

DROP POLICY IF EXISTS cycles_user_read ON public.cycle_runs;
CREATE POLICY cycles_user_read ON public.cycle_runs FOR SELECT TO public
USING ((user_id = public.current_app_user_id() AND public.app_runtime_enabled())
       OR public.current_app_role() = 'MASTER ADMIN');

DROP POLICY IF EXISTS referrals_user_read ON public.referrals;
CREATE POLICY referrals_user_read ON public.referrals FOR SELECT TO public
USING (((user_id = public.current_app_user_id() OR referred_user_id = public.current_app_user_id())
        AND public.app_runtime_enabled())
       OR public.current_app_role() = 'MASTER ADMIN');

DROP POLICY IF EXISTS tasks_user_select ON public.tasks;
CREATE POLICY tasks_user_select ON public.tasks FOR SELECT TO public
USING ((user_id = public.current_app_user_id() AND public.app_runtime_enabled())
       OR public.current_app_role() = 'MASTER ADMIN');

DROP POLICY IF EXISTS notifications_self_read ON public.notifications;
CREATE POLICY notifications_self_read ON public.notifications FOR SELECT TO public
USING ((user_id = public.current_app_user_id() AND public.app_runtime_enabled())
       OR public.current_app_role() = 'MASTER ADMIN');
DROP POLICY IF EXISTS notifications_self_update ON public.notifications;
CREATE POLICY notifications_self_update ON public.notifications FOR UPDATE TO public
USING (user_id = public.current_app_user_id() AND public.app_runtime_enabled())
WITH CHECK (user_id = public.current_app_user_id() AND public.app_runtime_enabled());

DROP POLICY IF EXISTS offers_public_read ON public.shop_offers;
CREATE POLICY offers_public_read ON public.shop_offers FOR SELECT TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL AND public.app_runtime_enabled());

DROP POLICY IF EXISTS verification_read_own_or_master ON storage.objects;
CREATE POLICY verification_read_own_or_master ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'private-verification' AND public.app_runtime_enabled()
       AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
            OR public.current_app_role() = 'MASTER ADMIN'));
DROP POLICY IF EXISTS verification_upload_own ON storage.objects;
CREATE POLICY verification_upload_own ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'private-verification' AND public.app_runtime_enabled()
            AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

COMMIT;
