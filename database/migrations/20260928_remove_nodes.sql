-- AegisPay node removal migration
-- Run this migration only when the retired node feature should be removed from an existing database.
BEGIN;
ALTER TABLE IF EXISTS public.tasks DROP COLUMN IF EXISTS related_node_id;
DROP TABLE IF EXISTS public.active_nodes CASCADE;
COMMIT;
