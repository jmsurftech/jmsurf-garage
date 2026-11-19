
ALTER TABLE public.business_settings 
ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'mpesa',
ADD COLUMN IF NOT EXISTS paystack_public_key text DEFAULT '',
ADD COLUMN IF NOT EXISTS paystack_secret_key text DEFAULT '';
