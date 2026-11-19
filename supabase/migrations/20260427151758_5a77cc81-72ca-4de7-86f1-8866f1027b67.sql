-- Link aggregator transactions back to POS transactions
ALTER TABLE public.aggregator_transactions
  ADD COLUMN IF NOT EXISTS pos_transaction_id uuid;

CREATE INDEX IF NOT EXISTS idx_agg_tx_pos_transaction_id
  ON public.aggregator_transactions(pos_transaction_id);

-- Allow authenticated POS users to insert pending aggregator transactions
-- (the existing public insert policy is fine, but POS callers may not match
-- the strict 254 phone regex prematurely; we keep that guard intact.)
-- No additional policy needed — existing agg_tx_public_insert covers it.

-- Backfill: ensure existing tenants table has slug index for fast aggregator lookup
CREATE INDEX IF NOT EXISTS idx_aggregator_tenants_slug
  ON public.aggregator_tenants(slug);
