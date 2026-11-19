
ALTER TABLE public.business_settings 
ADD COLUMN IF NOT EXISTS mpesa_account_reference text NULL DEFAULT '';
