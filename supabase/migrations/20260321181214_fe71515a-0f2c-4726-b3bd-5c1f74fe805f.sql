
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS at_api_key text DEFAULT '',
  ADD COLUMN IF NOT EXISTS at_username text DEFAULT '',
  ADD COLUMN IF NOT EXISTS at_sender_id text DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp_token text DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp_phone_id text DEFAULT '';
