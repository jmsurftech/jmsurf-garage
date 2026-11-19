-- Tenant bank accounts (one active per tenant)
CREATE TABLE IF NOT EXISTS public.tenant_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  bank_code text NOT NULL,
  account_number text NOT NULL,
  account_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  payhero_reference text,
  verification_status text NOT NULL DEFAULT 'pending',
  verification_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_bank_accounts_tenant ON public.tenant_bank_accounts(tenant_id);

ALTER TABLE public.tenant_bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tba_select" ON public.tenant_bank_accounts
  FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY "tba_manage" ON public.tenant_bank_accounts
  FOR ALL TO authenticated
  USING (
    (tenant_id = current_user_tenant_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')))
    OR has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    (tenant_id = current_user_tenant_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')))
    OR has_role(auth.uid(), 'super_admin')
  );

CREATE TRIGGER trg_tba_updated BEFORE UPDATE ON public.tenant_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Settlements: auto bank transfers after successful PayHero collections
CREATE TABLE IF NOT EXISTS public.settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_account_id uuid REFERENCES public.tenant_bank_accounts(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'pos',
  source_id text,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  payhero_withdrawal_id text,
  external_reference text,
  message text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlements_tenant ON public.settlements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON public.settlements(status);

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settlements_select" ON public.settlements
  FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY "settlements_manage" ON public.settlements
  FOR ALL TO authenticated
  USING (
    (tenant_id = current_user_tenant_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')))
    OR has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    (tenant_id = current_user_tenant_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')))
    OR has_role(auth.uid(), 'super_admin')
  );

CREATE TRIGGER trg_settlements_updated BEFORE UPDATE ON public.settlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();