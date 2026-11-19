ALTER TABLE public.tenant_domains
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_amount numeric(12,2) NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS payment_phone text,
  ADD COLUMN IF NOT EXISTS payment_checkout_id text,
  ADD COLUMN IF NOT EXISTS payment_receipt text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS dns_target text;

CREATE INDEX IF NOT EXISTS tenant_domains_checkout_idx ON public.tenant_domains (payment_checkout_id);

UPDATE public.tenant_domains SET payment_status = 'paid', paid_at = COALESCE(paid_at, approved_at, created_at)
 WHERE status = 'approved' AND payment_status = 'unpaid';