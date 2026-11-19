
-- Add split payment breakdown to transactions
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS split_payments jsonb DEFAULT '[]'::jsonb;

-- Link bills back to source purchase order so we don't double-create
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS purchase_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS bills_purchase_id_unique ON public.bills(purchase_id) WHERE purchase_id IS NOT NULL;

-- PayHero credential columns on business_settings
ALTER TABLE public.business_settings 
  ADD COLUMN IF NOT EXISTS payhero_api_username text DEFAULT '',
  ADD COLUMN IF NOT EXISTS payhero_api_password text DEFAULT '',
  ADD COLUMN IF NOT EXISTS payhero_channel_id text DEFAULT '';

-- Allow 'payhero' as a payment_provider value (existing column is text, no enum, so no constraint change needed)
-- Allow 'payhero' as a payment_method on transactions
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_payment_method_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_payment_method_check 
  CHECK (payment_method = ANY (ARRAY['cash'::text, 'mpesa'::text, 'card'::text, 'credit'::text, 'split'::text, 'mobile_money'::text, 'bank_transfer'::text, 'payhero'::text, 'other'::text]));
