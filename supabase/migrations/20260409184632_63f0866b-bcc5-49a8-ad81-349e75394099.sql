
CREATE TABLE public.cash_register (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id),
  location_id UUID REFERENCES public.locations(id),
  opened_by UUID NOT NULL,
  closed_by UUID,
  opening_float NUMERIC NOT NULL DEFAULT 0,
  cash_sales NUMERIC NOT NULL DEFAULT 0,
  cash_in NUMERIC NOT NULL DEFAULT 0,
  cash_out NUMERIC NOT NULL DEFAULT 0,
  expected_cash NUMERIC NOT NULL DEFAULT 0,
  actual_cash NUMERIC,
  difference NUMERIC,
  status TEXT NOT NULL DEFAULT 'open',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_register ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_register_select" ON public.cash_register
  FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY "cash_register_manage" ON public.cash_register
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER update_cash_register_updated_at
  BEFORE UPDATE ON public.cash_register
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
