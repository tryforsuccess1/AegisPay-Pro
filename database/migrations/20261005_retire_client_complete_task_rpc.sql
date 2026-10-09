-- Legacy single-task RPC is retired from the browser API.
-- Shop completion is now performed only by the server-side exact task-set endpoint.
REVOKE EXECUTE ON FUNCTION public.complete_task(UUID) FROM authenticated;
