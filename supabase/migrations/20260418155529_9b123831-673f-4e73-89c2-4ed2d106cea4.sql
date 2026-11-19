
CREATE TABLE IF NOT EXISTS public.tenant_themes (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  theme_name text NOT NULL DEFAULT 'Emerald',
  custom_color text NOT NULL DEFAULT '#3b82f6',
  dark_mode boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.tenant_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "themes_select_tenant_members"
ON public.tenant_themes FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "themes_manage_admin"
ON public.tenant_themes FOR ALL TO authenticated
USING (
  ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
    AND tenant_id = current_user_tenant_id())
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
    AND tenant_id = current_user_tenant_id())
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_themes;
