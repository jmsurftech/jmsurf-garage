
CREATE TABLE public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0,
  gateway text NOT NULL DEFAULT 'mpesa',
  status text NOT NULL DEFAULT 'pending',
  reference text,
  phone text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sp_super_admin" ON public.subscription_payments FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "sp_tenant_select" ON public.subscription_payments FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL));

CREATE POLICY "sp_tenant_insert" ON public.subscription_payments FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL));
