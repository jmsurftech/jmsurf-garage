
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS activation_fee_paid_at TIMESTAMPTZ;
UPDATE public.tenants SET activation_fee_paid_at = COALESCE(created_at, now()) WHERE activation_fee_paid_at IS NULL;
