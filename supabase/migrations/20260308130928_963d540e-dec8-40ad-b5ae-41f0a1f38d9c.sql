
ALTER TABLE public.business_settings 
ADD COLUMN IF NOT EXISTS mpesa_consumer_key text DEFAULT '',
ADD COLUMN IF NOT EXISTS mpesa_consumer_secret text DEFAULT '',
ADD COLUMN IF NOT EXISTS mpesa_passkey text DEFAULT '';
