
-- Replace overly-permissive profile select that let any admin see all tenants
DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_select_tenant ON public.profiles;

CREATE POLICY profiles_select_self
  ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY profiles_select_super_admin
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY profiles_select_same_tenant
  ON public.profiles FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = public.current_user_tenant_id()
  );

-- Tighten business_settings: cross-tenant access only via super_admin
DROP POLICY IF EXISTS biz_settings_select ON public.business_settings;
CREATE POLICY biz_settings_select
  ON public.business_settings FOR SELECT TO authenticated
  USING (
    (tenant_id = public.current_user_tenant_id())
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

-- Tighten locations: only super_admin can read across tenants
DROP POLICY IF EXISTS locations_select ON public.locations;
CREATE POLICY locations_select
  ON public.locations FOR SELECT TO authenticated
  USING (
    (tenant_id = public.current_user_tenant_id())
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );
