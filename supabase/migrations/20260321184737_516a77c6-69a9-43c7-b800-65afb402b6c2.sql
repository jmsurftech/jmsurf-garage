
DROP POLICY IF EXISTS biz_settings_select ON public.business_settings;
CREATE POLICY biz_settings_select ON public.business_settings FOR SELECT TO authenticated
  USING (
    (
      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
      AND (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role))
    )
  );
