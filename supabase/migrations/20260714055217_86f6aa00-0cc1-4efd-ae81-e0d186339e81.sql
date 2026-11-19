
ALTER TABLE public.aggregator_tenants
  ADD COLUMN IF NOT EXISTS payout_destination_type text NOT NULL DEFAULT 'till'
    CHECK (payout_destination_type IN ('till','paybill','bank')),
  ADD COLUMN IF NOT EXISTS payout_till_number text,
  ADD COLUMN IF NOT EXISTS payout_paybill_number text,
  ADD COLUMN IF NOT EXISTS payout_paybill_account text,
  ADD COLUMN IF NOT EXISTS payout_bank_code text,
  ADD COLUMN IF NOT EXISTS payout_bank_account text,
  ADD COLUMN IF NOT EXISTS payout_bank_account_name text,
  ADD COLUMN IF NOT EXISTS auto_payout_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS min_payout_amount integer NOT NULL DEFAULT 1;
