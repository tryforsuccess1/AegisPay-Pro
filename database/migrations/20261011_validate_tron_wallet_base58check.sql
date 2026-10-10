-- Case-sensitive TRON Base58Check validation and wallet-safe withdrawals.
CREATE OR REPLACE FUNCTION public.is_valid_tron_address(p_address text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $function$
DECLARE
  alphabet_bytes bytea := convert_to('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz','UTF8');
  v_address text := trim(COALESCE(p_address,''));
  v_number numeric := 0;
  v_index integer;
  v_i integer;
  v_hex text := '';
  v_bytes bytea;
  v_hash bytea;
BEGIN
  IF v_address !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN RETURN FALSE; END IF;
  FOR v_i IN 1..length(v_address) LOOP
    v_index := position(convert_to(substr(v_address,v_i,1),'UTF8') in alphabet_bytes)-1;
    IF v_index < 0 THEN RETURN FALSE; END IF;
    v_number := v_number*58+v_index;
  END LOOP;
  IF v_number >= power(2::numeric,200) THEN RETURN FALSE; END IF;
  WHILE v_number>0 LOOP
    v_hex := lpad(to_hex(mod(v_number,256)::integer),2,'0')||v_hex;
    v_number := div(v_number,256);
  END LOOP;
  IF length(v_hex)>50 THEN RETURN FALSE; END IF;
  v_bytes := decode(lpad(v_hex,50,'0'),'hex');
  IF get_byte(v_bytes,0)<>65 THEN RETURN FALSE; END IF;
  v_hash := extensions.digest(extensions.digest(substring(v_bytes from 1 for 21),'sha256'),'sha256');
  RETURN substring(v_bytes from 22 for 4)=substring(v_hash from 1 for 4);
END;
$function$;
REVOKE ALL ON FUNCTION public.is_valid_tron_address(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_tron_address(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.link_withdrawal_wallet(p_address text,p_owner_name text)
RETURNS public.users LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $function$
DECLARE v_user public.users; v_address text:=trim(COALESCE(p_address,''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication is required'; END IF;
  SELECT * INTO v_user FROM public.users WHERE auth_user_id=auth.uid() FOR UPDATE;
  IF v_user.id IS NULL OR v_user.role<>'USER' THEN RAISE EXCEPTION 'Client profile not found'; END IF;
  IF upper(COALESCE(v_user.status,'')) IN ('BLOCKED','SUSPENDED','DELETED') THEN RAISE EXCEPTION 'This account cannot link a withdrawal wallet'; END IF;
  IF v_user.frozen_until IS NOT NULL AND v_user.frozen_until>NOW() THEN
    RAISE EXCEPTION 'Account is temporarily frozen for security until %',to_char(v_user.frozen_until AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI UTC');
  END IF;
  IF COALESCE(v_user.destination_address,'')<>'' THEN RAISE EXCEPTION 'Withdrawal wallet is already linked'; END IF;
  IF NOT public.is_valid_tron_address(v_address) THEN RAISE EXCEPTION 'Enter a valid case-sensitive TRON Base58Check wallet address'; END IF;
  IF lower(trim(COALESCE(p_owner_name,'')))<>lower(trim(v_user.name)) THEN RAISE EXCEPTION 'Wallet owner name must match the profile name'; END IF;
  UPDATE public.users SET destination_address=v_address,withdrawal_wallet_owner_name=trim(p_owner_name)
    WHERE id=v_user.id RETURNING * INTO v_user;
  RETURN v_user;
END;
$function$;
REVOKE ALL ON FUNCTION public.link_withdrawal_wallet(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_withdrawal_wallet(text,text) TO authenticated;

-- Keep the retired single-argument overload case-sensitive and checksum-validated.
CREATE OR REPLACE FUNCTION public.link_withdrawal_wallet(p_wallet text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $function$
DECLARE v_user uuid; v_existing text; v_wallet text:=trim(COALESCE(p_wallet,''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication is required'; END IF;
  v_user:=public.current_app_user_id();
  IF v_user IS NULL THEN RAISE EXCEPTION 'AegisPay profile not found'; END IF;
  IF NOT public.is_valid_tron_address(v_wallet) THEN RAISE EXCEPTION 'Enter a valid case-sensitive TRON Base58Check wallet address'; END IF;
  SELECT destination_address INTO v_existing FROM public.users WHERE id=v_user FOR UPDATE;
  IF COALESCE(trim(v_existing),'')<>'' THEN RAISE EXCEPTION 'Withdrawal wallet is already linked. Only Master Admin can change it.'; END IF;
  UPDATE public.users SET destination_address=v_wallet WHERE id=v_user AND COALESCE(trim(destination_address),'')='';
  RETURN v_wallet;
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $function$
DECLARE
 v_user_id uuid; v_role text; v_balance numeric; v_withdrawal_held numeric; v_pending numeric;
 v_wallet text; v_status text; v_frozen_until timestamptz; v_request_id uuid;
 v_fee_rate numeric:=0.10; v_fee numeric; v_net numeric; v_risk numeric;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication is required'; END IF;
 IF NOT public.app_runtime_enabled() THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='AegisPay is paused by Master Admin'; END IF;
 v_user_id:=public.current_app_user_id();
 IF v_user_id IS NULL THEN RAISE EXCEPTION 'AegisPay profile not found'; END IF;
 SELECT role,current_platform_balance,withdrawal_held,destination_address,status,frozen_until
 INTO v_role,v_balance,v_withdrawal_held,v_wallet,v_status,v_frozen_until
 FROM public.users WHERE id=v_user_id FOR UPDATE;
 IF v_role<>'USER' THEN RAISE EXCEPTION 'Only client accounts may request withdrawals'; END IF;
 IF upper(COALESCE(v_status,'')) NOT IN ('ACTIVE','NORMAL') THEN RAISE EXCEPTION 'This account is not allowed to request withdrawals'; END IF;
 IF v_frozen_until IS NOT NULL AND v_frozen_until>NOW() THEN
   RAISE EXCEPTION 'Account is temporarily frozen for security until %',to_char(v_frozen_until AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI UTC');
 END IF;
 IF p_amount IS NULL OR p_amount<50 THEN RAISE EXCEPTION 'Minimum withdrawal is $50'; END IF;
 IF COALESCE(v_wallet,'')='' THEN RAISE EXCEPTION 'Link a withdrawal wallet before requesting a withdrawal'; END IF;
 IF NOT public.is_valid_tron_address(v_wallet) THEN
   RAISE EXCEPTION 'The linked withdrawal wallet is invalid. Contact Master Admin to correct the exact case-sensitive address before requesting a payout';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.kyc_verifications WHERE user_id=v_user_id AND status='VERIFIED') THEN RAISE EXCEPTION 'Complete KYC verification before requesting a withdrawal'; END IF;
 SELECT COALESCE((value_json->>'fee_rate')::numeric,0.10) INTO v_fee_rate FROM public.platform_settings WHERE key='withdrawal_rules';
 v_fee_rate:=LEAST(0.25,GREATEST(0,COALESCE(v_fee_rate,0.10)));
 v_fee:=round(p_amount*v_fee_rate,2); v_net:=p_amount-v_fee; v_risk:=round(least(0.35,greatest(0.02,p_amount/5000)),4);
 SELECT COALESCE(sum(amount),0) INTO v_pending FROM public.withdrawal_requests WHERE user_id=v_user_id AND status IN ('PENDING_APPROVAL','APPROVED','PROCESSING');
 IF p_amount>COALESCE(v_balance,0)-GREATEST(COALESCE(v_withdrawal_held,0),v_pending) THEN RAISE EXCEPTION 'Withdrawal exceeds available balance'; END IF;
 INSERT INTO public.withdrawal_requests(user_id,amount,destination_address,ai_risk_score,fee_amount,net_amount)
 VALUES(v_user_id,p_amount,v_wallet,v_risk,v_fee,v_net) RETURNING id INTO v_request_id;
 UPDATE public.users SET withdrawal_held=GREATEST(COALESCE(withdrawal_held,0),v_pending)+p_amount WHERE id=v_user_id;
 RETURN v_request_id;
END;
$function$;
COMMENT ON FUNCTION public.is_valid_tron_address(text) IS 'Validates case-sensitive TRON Base58Check address using double SHA-256 checksum.';
COMMENT ON FUNCTION public.link_withdrawal_wallet(text,text) IS 'Client-only wallet linking; preserves case, validates checksum, and verifies profile owner name.';
