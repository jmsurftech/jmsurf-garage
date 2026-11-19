-- Drop the existing check constraint and recreate with 'cancelled' included
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_status_check CHECK (status IN ('completed', 'pending', 'failed', 'cancelled', 'refunded'));