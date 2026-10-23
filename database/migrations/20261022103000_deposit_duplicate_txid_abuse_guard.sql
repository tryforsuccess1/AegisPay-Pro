BEGIN;

CREATE TABLE IF NOT EXISTS public.deposit_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type = 'DUPLICATE_TXID_ATTEMPT'),
  txid_sha256 text NOT NULL CHECK (txid_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deposit_security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deposit_security_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.deposit_security_events TO service_role;

CREATE INDEX IF NOT EXISTS deposit_security_events_user_recent_idx
  ON public.deposit_security_events (user_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS deposit_security_events_user_txid_recent_idx
  ON public.deposit_security_events (user_id, txid_sha256, created_at DESC);

CREATE OR REPLACE FUNCTION public.register_duplicate_deposit_txid_attempt(
  p_user_id uuid,
  p_txid_sha256 text
)
RETURNS TABLE(attempt_count integer, blocked boolean, counted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_status text;
  v_count integer := 0;
  v_counted boolean := false;
  v_blocked boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_txid_sha256 IS NULL
     OR p_txid_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A user ID and SHA-256 TXID fingerprint are required';
  END IF;

  SELECT u.status INTO v_status
    FROM public.users u
   WHERE u.id = p_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='User not found';
  END IF;

  -- Count at most one retry of the same TXID within five minutes. This prevents
  -- an accidental double-click/network retry from becoming multiple strikes.
  IF NOT EXISTS (
    SELECT 1 FROM public.deposit_security_events e
     WHERE e.user_id = p_user_id
       AND e.event_type = 'DUPLICATE_TXID_ATTEMPT'
       AND e.txid_sha256 = lower(p_txid_sha256)
       AND e.created_at >= now() - interval '5 minutes'
  ) AND upper(coalesce(v_status,'')) NOT IN ('BLOCKED','SUSPENDED','DELETED') THEN
    INSERT INTO public.deposit_security_events(user_id,event_type,txid_sha256)
    VALUES(p_user_id,'DUPLICATE_TXID_ATTEMPT',lower(p_txid_sha256));
    v_counted := true;
  END IF;

  SELECT count(*)::integer INTO v_count
    FROM public.deposit_security_events e
   WHERE e.user_id = p_user_id
     AND e.event_type = 'DUPLICATE_TXID_ATTEMPT'
     AND e.created_at >= now() - interval '30 days';

  IF v_count >= 2 AND upper(coalesce(v_status,'')) NOT IN ('BLOCKED','SUSPENDED','DELETED') THEN
    UPDATE public.users SET status='BLOCKED' WHERE id=p_user_id;
    v_blocked := true;
    INSERT INTO public.audit_events(actor_user_id,target_user_id,event_type,description,reference_id)
    VALUES(NULL,p_user_id,'USER_BLOCKED_DUPLICATE_TXID',
      'Account blocked after three distinct duplicate-TXID attempts within 30 days. No source TXID was stored in this security event.',
      NULL);
  ELSE
    v_blocked := upper(coalesce(v_status,''))='BLOCKED';
  END IF;

  RETURN QUERY SELECT v_count,v_blocked,v_counted;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_duplicate_deposit_txid_attempt(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_duplicate_deposit_txid_attempt(uuid,text) TO service_role;

COMMIT;
