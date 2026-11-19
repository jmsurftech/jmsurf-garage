
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS intasend_account_type text NOT NULL DEFAULT 'paybill',
  ADD COLUMN IF NOT EXISTS intasend_account_number text DEFAULT '';

-- Allow 'intasend' as a payment_provider value (column is plain text, no CHECK to update).

CREATE TABLE IF NOT EXISTS public.intasend_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pos_transaction_id uuid,
  invoice_id text,
  api_ref text,
  intasend_invoice_id text,
  checkout_id text,
  method text NOT NULL DEFAULT 'M-PESA',
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  customer_phone text,
  customer_email text,
  status text NOT NULL DEFAULT 'pending',
  failed_reason text,
  mpesa_receipt text,
  raw_callback jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intasend_tx_tenant_idx ON public.intasend_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS intasend_tx_apiref_idx ON public.intasend_transactions(api_ref);
CREATE INDEX IF NOT EXISTS intasend_tx_invoice_idx ON public.intasend_transactions(intasend_invoice_id);

ALTER TABLE public.intasend_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ist_select ON public.intasend_transactions
  FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY ist_admin_all ON public.intasend_transactions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER intasend_tx_updated_at
  BEFORE UPDATE ON public.intasend_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
