CREATE TABLE IF NOT EXISTS public.empties_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  item_label text NOT NULL,
  container_kind text NOT NULL DEFAULT 'bottle',
  direction text NOT NULL DEFAULT 'in',
  quantity numeric(14,3) NOT NULL DEFAULT 0,
  deposit_per_unit numeric(12,2) NOT NULL DEFAULT 0,
  deposit_total numeric(12,2) NOT NULL DEFAULT 0,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.empties_ledger TO authenticated;
GRANT ALL ON public.empties_ledger TO service_role;

ALTER TABLE public.empties_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS empties_ledger_select ON public.empties_ledger;
CREATE POLICY empties_ledger_select ON public.empties_ledger FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS empties_ledger_write ON public.empties_ledger;
CREATE POLICY empties_ledger_write ON public.empties_ledger FOR ALL TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS empties_ledger_tenant_idx ON public.empties_ledger (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS update_empties_ledger_updated_at ON public.empties_ledger;
CREATE TRIGGER update_empties_ledger_updated_at BEFORE UPDATE ON public.empties_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();