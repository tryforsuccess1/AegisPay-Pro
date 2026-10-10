-- Use div(numeric,numeric) for exact integer division of the decoded Base58 number.
CREATE OR REPLACE FUNCTION public.is_valid_tron_address(p_address text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $function$
DECLARE
 alphabet_bytes bytea:=convert_to('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz','UTF8');
 v_address text:=trim(COALESCE(p_address,'')); v_number numeric:=0; v_index integer; v_i integer;
 v_hex text:=''; v_bytes bytea; v_hash bytea;
BEGIN
 IF v_address !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN RETURN FALSE; END IF;
 FOR v_i IN 1..length(v_address) LOOP
  v_index:=position(convert_to(substr(v_address,v_i,1),'UTF8') in alphabet_bytes)-1;
  IF v_index<0 THEN RETURN FALSE; END IF;
  v_number:=v_number*58+v_index;
 END LOOP;
 IF v_number>=power(2::numeric,200) THEN RETURN FALSE; END IF;
 WHILE v_number>0 LOOP
  v_hex:=lpad(to_hex(mod(v_number,256)::integer),2,'0')||v_hex;
  v_number:=div(v_number,256);
 END LOOP;
 IF length(v_hex)>50 THEN RETURN FALSE; END IF;
 v_bytes:=decode(lpad(v_hex,50,'0'),'hex');
 IF get_byte(v_bytes,0)<>65 THEN RETURN FALSE; END IF;
 v_hash:=extensions.digest(extensions.digest(substring(v_bytes from 1 for 21),'sha256'),'sha256');
 RETURN substring(v_bytes from 22 for 4)=substring(v_hash from 1 for 4);
END;
$function$;
REVOKE ALL ON FUNCTION public.is_valid_tron_address(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_valid_tron_address(text) TO authenticated,service_role;
COMMENT ON FUNCTION public.is_valid_tron_address(text) IS 'Validates exact-case TRON Base58Check address, including TRON prefix and double-SHA256 checksum.';
