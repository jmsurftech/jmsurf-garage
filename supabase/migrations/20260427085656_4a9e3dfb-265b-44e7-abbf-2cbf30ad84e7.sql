ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS wholesale_eligible boolean NOT NULL DEFAULT false;