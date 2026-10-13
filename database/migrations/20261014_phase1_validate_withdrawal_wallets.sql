-- Phase 1: validate exact-case TRON Base58Check wallet addresses at the database boundary.
-- Existing withdrawal history is intentionally untouched; only new writes and address changes are validated.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_valid_tron_withdrawal_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- A user may have no saved wallet yet. Withdrawal requests must always carry a valid destination.
  IF TG_TABLE_NAME = 'users'
     AND COALESCE(trim(NEW.destination_address), '') = '' THEN
    RETURN NEW;
  END IF;

  -- NULL must fail closed too; PL/pgSQL IF treats a NULL condition as not true.
  IF COALESCE(public.is_valid_tron_address(NEW.destination_address), false) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Enter a valid case-sensitive TRON Base58Check wallet address';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS users_validate_withdrawal_destination ON public.users;
CREATE TRIGGER users_validate_withdrawal_destination
BEFORE INSERT OR UPDATE OF destination_address ON public.users
FOR EACH ROW EXECUTE FUNCTION public.enforce_valid_tron_withdrawal_address();

DROP TRIGGER IF EXISTS withdrawal_requests_validate_destination ON public.withdrawal_requests;
CREATE TRIGGER withdrawal_requests_validate_destination
BEFORE INSERT OR UPDATE OF destination_address ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_valid_tron_withdrawal_address();

COMMIT;
