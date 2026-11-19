ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS mpesa_error_message TEXT,
ADD COLUMN IF NOT EXISTS mpesa_error_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_transactions_mpesa_error_payload
ON public.transactions USING GIN (mpesa_error_payload);