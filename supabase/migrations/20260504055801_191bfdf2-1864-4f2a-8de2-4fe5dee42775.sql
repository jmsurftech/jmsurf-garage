-- Offline sync hardening: idempotent transactions via event_id
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS event_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_event_id_unique
  ON public.transactions (event_id) WHERE event_id IS NOT NULL;

-- Allow negative stock so offline sales never get rejected on sync.
-- (No constraint exists today; this is a no-op safety guard for future migrations.)

-- Suspended subscription status support
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;
