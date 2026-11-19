
ALTER TABLE public.aggregator_payouts
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS is_test_payout boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_payout_id uuid REFERENCES public.aggregator_payouts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agg_payouts_idem ON public.aggregator_payouts(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agg_payouts_retry ON public.aggregator_payouts(next_retry_at) WHERE status = 'failed' AND next_retry_at IS NOT NULL;

ALTER TABLE public.aggregator_settings ALTER COLUMN commission_percent SET DEFAULT 0;
UPDATE public.aggregator_settings SET commission_percent = 0 WHERE commission_percent IS NULL;
