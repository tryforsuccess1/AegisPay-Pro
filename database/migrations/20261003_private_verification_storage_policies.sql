-- Track the live private verification storage hardening in the canonical repository.
-- The bucket is private and evidence paths are scoped to auth.uid().
-- This migration intentionally does not alter financial balances or deposit verification.
DROP POLICY IF EXISTS verification_upload_own ON storage.objects;
CREATE POLICY verification_upload_own
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='private-verification'
  AND app_runtime_enabled()
  AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
);

DROP POLICY IF EXISTS verification_read_own_or_master ON storage.objects;
CREATE POLICY verification_read_own_or_master
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='private-verification'
  AND app_runtime_enabled()
  AND (
    (storage.foldername(name))[1]=(SELECT auth.uid())::text
    OR current_app_role()='MASTER ADMIN'
  )
);

DROP POLICY IF EXISTS verification_delete_own ON storage.objects;
CREATE POLICY verification_delete_own
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id='private-verification'
  AND app_runtime_enabled()
  AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
);
