
ALTER TABLE public.business_settings 
ADD COLUMN IF NOT EXISTS mpesa_transaction_type text NOT NULL DEFAULT 'CustomerPayBillOnline',
ADD COLUMN IF NOT EXISTS mpesa_till_number text NULL DEFAULT '';
