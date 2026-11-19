DROP TABLE IF EXISTS public.intasend_transactions CASCADE;

ALTER TABLE public.business_settings
  DROP COLUMN IF EXISTS intasend_account_type,
  DROP COLUMN IF EXISTS intasend_account_number;

UPDATE public.business_settings
  SET payment_provider = 'mpesa'
  WHERE payment_provider = 'intasend';