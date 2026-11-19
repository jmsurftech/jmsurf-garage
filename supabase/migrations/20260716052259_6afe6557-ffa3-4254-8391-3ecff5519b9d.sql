-- Backfill payout destination fields for pre-existing aggregator merchants
UPDATE public.aggregator_tenants
SET
  payout_destination_type = CASE
    WHEN mpesa_type = 'paybill' THEN 'paybill'
    ELSE 'till'
  END,
  payout_till_number = CASE
    WHEN COALESCE(mpesa_type, 'till') = 'till' AND mpesa_number ~ '^\d{5,7}$' THEN mpesa_number
    ELSE payout_till_number
  END,
  payout_paybill_number = CASE
    WHEN mpesa_type = 'paybill' AND mpesa_number ~ '^\d{5,7}$' THEN mpesa_number
    ELSE payout_paybill_number
  END,
  payout_paybill_account = CASE
    WHEN mpesa_type = 'paybill' AND (payout_paybill_account IS NULL OR payout_paybill_account = '') THEN name
    ELSE payout_paybill_account
  END
WHERE mpesa_number IS NOT NULL
  AND (
    (COALESCE(mpesa_type, 'till') = 'till' AND payout_till_number IS NULL)
    OR (mpesa_type = 'paybill' AND payout_paybill_number IS NULL)
  );

-- Composite index for the tenant-scoped, time-ordered payouts query
CREATE INDEX IF NOT EXISTS idx_agg_payouts_tenant_created_at
  ON public.aggregator_payouts (aggregator_tenant_id, created_at DESC);

-- Composite index for aggregator_transactions used by the same dashboard
CREATE INDEX IF NOT EXISTS idx_agg_tx_tenant_created_at
  ON public.aggregator_transactions (aggregator_tenant_id, created_at DESC);
