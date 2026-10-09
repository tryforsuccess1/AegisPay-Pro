-- AegisPay username login alias
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username text;

UPDATE public.users
SET username = lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9_]+', '', 'g'))
WHERE username IS NULL AND email IS NOT NULL;

UPDATE public.users u
SET username = left(regexp_replace(coalesce(u.username, 'user'), '[^a-zA-Z0-9_]+', '', 'g'), 24) || right(replace(u.id::text, '-', ''), 6)
WHERE u.username IS NULL OR length(trim(u.username)) < 3;

ALTER TABLE public.users ALTER COLUMN username SET NOT NULL;
ALTER TABLE public.users ADD CONSTRAINT users_username_format_chk CHECK (username ~ '^[a-z0-9_]{3,32}$');
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uidx ON public.users (lower(username));

CREATE OR REPLACE FUNCTION public.resolve_login_email(p_username text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email
  FROM public.users
  WHERE lower(username) = lower(trim(p_username))
    AND status IN ('Active','ACTIVE','NORMAL')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_login_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated;
