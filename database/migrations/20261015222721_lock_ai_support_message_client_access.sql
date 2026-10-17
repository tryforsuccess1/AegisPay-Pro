-- Make the intentional client-deny posture for live support messages explicit.
-- Chat is accessed through the authenticated ai-support Edge Function using service_role.
ALTER TABLE public.ai_support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.ai_support_messages FROM anon, authenticated;

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_support_messages'
      AND policyname = 'ai_support_messages_deny_client_access'
  ) THEN
    CREATE POLICY ai_support_messages_deny_client_access
      ON public.ai_support_messages
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END;
$policy$;
