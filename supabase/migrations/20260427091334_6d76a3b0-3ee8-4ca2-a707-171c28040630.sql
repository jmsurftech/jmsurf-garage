-- Add event_id for client-generated deduplication of audit events
ALTER TABLE public.user_activity_log
  ADD COLUMN IF NOT EXISTS event_id uuid;

-- Unique per (tenant, event_id) so the same offline-queued event can never
-- be inserted twice when the sync queue retries after a reconnect.
CREATE UNIQUE INDEX IF NOT EXISTS user_activity_log_tenant_event_id_key
  ON public.user_activity_log (tenant_id, event_id)
  WHERE event_id IS NOT NULL;