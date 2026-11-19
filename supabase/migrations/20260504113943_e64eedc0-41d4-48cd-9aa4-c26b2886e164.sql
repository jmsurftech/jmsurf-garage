CREATE TABLE IF NOT EXISTS public.tenant_sms_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT false,
  balance_units integer NOT NULL DEFAULT 0,
  price_per_sms numeric NOT NULL DEFAULT 1.50,
  sender_id text DEFAULT '',
  total_sent integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_sms_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tss_select" ON public.tenant_sms_settings FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "tss_super_admin_manage" ON public.tenant_sms_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin')) WITH CHECK (has_role(auth.uid(), 'super_admin'));

CREATE TABLE IF NOT EXISTS public.tenant_sms_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  units_added integer NOT NULL,
  amount_paid numeric NOT NULL DEFAULT 0,
  price_per_sms numeric NOT NULL DEFAULT 0,
  reference text DEFAULT '',
  notes text DEFAULT '',
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_sms_topups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tst_select" ON public.tenant_sms_topups FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "tst_super_admin_insert" ON public.tenant_sms_topups FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'super_admin'));
CREATE INDEX IF NOT EXISTS idx_tst_tenant ON public.tenant_sms_topups(tenant_id, created_at DESC);