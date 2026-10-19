-- Keep support screenshots and small documents private. The service-role Edge Function
-- stores objects and returns signed URLs only after checking case ownership/role.
ALTER TABLE public.ai_support_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_support_messages_attachments_is_array'
      AND conrelid = 'public.ai_support_messages'::regclass
  ) THEN
    ALTER TABLE public.ai_support_messages
      ADD CONSTRAINT ai_support_messages_attachments_is_array
      CHECK (jsonb_typeof(attachments) = 'array') NOT VALID;
  END IF;
END $$;

ALTER TABLE public.ai_support_messages
  VALIDATE CONSTRAINT ai_support_messages_attachments_is_array;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'private-support-attachments',
  'private-support-attachments',
  false,
  3145728,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
