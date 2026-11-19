-- Tenant payout channels (PayHero)
CREATE TABLE IF NOT EXISTS public.tenant_payout_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  channel_type text NOT NULL CHECK (channel_type IN ('paybill','till','bank','mobile')),
  short_code text NOT NULL,
  account_number text DEFAULT '',
  description text DEFAULT '',
  payhero_channel_id text,
  is_default boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  registered_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tpc_tenant ON public.tenant_payout_channels(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tpc_tenant_default
  ON public.tenant_payout_channels(tenant_id)
  WHERE is_default = true AND is_active = true;

ALTER TABLE public.tenant_payout_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY tpc_select ON public.tenant_payout_channels
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY tpc_manage ON public.tenant_payout_channels
  FOR ALL TO authenticated
  USING (
    (tenant_id = public.current_user_tenant_id()
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')))
    OR public.has_role(auth.uid(),'super_admin')
  )
  WITH CHECK (
    (tenant_id = public.current_user_tenant_id()
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')))
    OR public.has_role(auth.uid(),'super_admin')
  );

CREATE TRIGGER tpc_set_updated_at
  BEFORE UPDATE ON public.tenant_payout_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PayHero transactions log
CREATE TABLE IF NOT EXISTS public.payhero_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pos_transaction_id uuid,
  payout_channel_id uuid REFERENCES public.tenant_payout_channels(id) ON DELETE SET NULL,
  payhero_payment_id text,
  external_reference text,
  amount numeric NOT NULL,
  customer_phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  mpesa_receipt text,
  result_code integer,
  result_desc text,
  disbursed boolean NOT NULL DEFAULT false,
  disbursed_at timestamptz,
  disburse_reference text,
  raw_callback jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pht_tenant ON public.payhero_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pht_pos_tx ON public.payhero_transactions(pos_transaction_id);
CREATE INDEX IF NOT EXISTS idx_pht_external ON public.payhero_transactions(external_reference);
CREATE INDEX IF NOT EXISTS idx_pht_status ON public.payhero_transactions(status);

ALTER TABLE public.payhero_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY pht_select ON public.payhero_transactions
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(),'super_admin'));

CREATE POLICY pht_admin_all ON public.payhero_transactions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'super_admin'));

CREATE TRIGGER pht_set_updated_at
  BEFORE UPDATE ON public.payhero_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();