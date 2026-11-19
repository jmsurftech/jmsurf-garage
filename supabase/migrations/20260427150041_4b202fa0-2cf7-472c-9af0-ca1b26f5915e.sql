
-- Aggregator settings (single row)
CREATE TABLE public.aggregator_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_percent numeric NOT NULL DEFAULT 2,
  brand_name text NOT NULL DEFAULT 'JMSURF Pay',
  support_phone text DEFAULT '0712504593',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.aggregator_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY agg_settings_select ON public.aggregator_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY agg_settings_manage ON public.aggregator_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));
INSERT INTO public.aggregator_settings (commission_percent) VALUES (2);

-- Aggregator tenants (merchants registered under the aggregator)
CREATE TABLE public.aggregator_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, -- linked Supabase auth user (optional; admin can create without login)
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  email text NOT NULL,
  phone text NOT NULL,
  mpesa_type text NOT NULL DEFAULT 'paybill' CHECK (mpesa_type IN ('paybill','till')),
  mpesa_number text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_agg_tenants_user_id ON public.aggregator_tenants(user_id);
CREATE INDEX idx_agg_tenants_slug ON public.aggregator_tenants(slug);
ALTER TABLE public.aggregator_tenants ENABLE ROW LEVEL SECURITY;

-- Public can read minimal info by slug for the pay page (name, slug, mpesa_type, is_active)
CREATE POLICY agg_tenants_public_read ON public.aggregator_tenants FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- Owner can update their own row (only mpesa fields enforced via column-level app logic)
CREATE POLICY agg_tenants_owner_update ON public.aggregator_tenants FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Super admin full control
CREATE POLICY agg_tenants_admin_all ON public.aggregator_tenants FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- Aggregator transactions
CREATE TABLE public.aggregator_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregator_tenant_id uuid NOT NULL REFERENCES public.aggregator_tenants(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  customer_phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','cancelled')),
  checkout_request_id text,
  merchant_request_id text,
  mpesa_receipt text,
  result_code integer,
  result_desc text,
  commission_amount numeric NOT NULL DEFAULT 0,
  commission_percent numeric NOT NULL DEFAULT 0,
  destination_type text NOT NULL,        -- snapshot at time of payment
  destination_number text NOT NULL,      -- snapshot at time of payment
  raw_callback jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_agg_tx_tenant ON public.aggregator_transactions(aggregator_tenant_id);
CREATE INDEX idx_agg_tx_checkout ON public.aggregator_transactions(checkout_request_id);
CREATE INDEX idx_agg_tx_status ON public.aggregator_transactions(status);
ALTER TABLE public.aggregator_transactions ENABLE ROW LEVEL SECURITY;

-- Public can insert pending transactions (validated by app & edge function)
CREATE POLICY agg_tx_public_insert ON public.aggregator_transactions FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'pending'
    AND amount > 0 AND amount <= 150000
    AND customer_phone ~ '^254[17][0-9]{8}$'
    AND aggregator_tenant_id IS NOT NULL
  );

-- Tenant can view their own transactions
CREATE POLICY agg_tx_tenant_select ON public.aggregator_transactions FOR SELECT TO authenticated
  USING (
    aggregator_tenant_id IN (SELECT id FROM public.aggregator_tenants WHERE user_id = auth.uid())
  );

-- Super admin full access
CREATE POLICY agg_tx_admin_all ON public.aggregator_transactions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- Updated_at triggers
CREATE TRIGGER trg_agg_tenants_updated BEFORE UPDATE ON public.aggregator_tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_agg_tx_updated BEFORE UPDATE ON public.aggregator_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_agg_settings_updated BEFORE UPDATE ON public.aggregator_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
