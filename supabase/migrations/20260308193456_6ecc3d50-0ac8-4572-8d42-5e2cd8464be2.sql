CREATE TABLE public.email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  smtp_response text,
  smtp_host text,
  from_email text,
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view email logs"
  ON public.email_logs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Staff can insert email logs"
  ON public.email_logs FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin')
  );

CREATE INDEX idx_email_logs_created_at ON public.email_logs(created_at DESC);
CREATE INDEX idx_email_logs_tenant_id ON public.email_logs(tenant_id);