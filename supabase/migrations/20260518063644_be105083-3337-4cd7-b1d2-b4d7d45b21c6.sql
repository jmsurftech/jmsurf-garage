
-- ============ product_stocks ============
DROP POLICY IF EXISTS prod_stocks_select ON public.product_stocks;
DROP POLICY IF EXISTS prod_stocks_manage ON public.product_stocks;

CREATE POLICY prod_stocks_select ON public.product_stocks FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin')
  OR EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = product_stocks.location_id
      AND l.tenant_id = public.current_user_tenant_id()
  )
);

CREATE POLICY prod_stocks_manage ON public.product_stocks FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin')
  OR (
    (public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'stock_manager')
      OR public.has_role(auth.uid(), 'cashier'))
    AND EXISTS (
      SELECT 1 FROM public.locations l
      WHERE l.id = product_stocks.location_id
        AND l.tenant_id = public.current_user_tenant_id()
    )
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin')
  OR (
    (public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'stock_manager')
      OR public.has_role(auth.uid(), 'cashier'))
    AND EXISTS (
      SELECT 1 FROM public.locations l
      WHERE l.id = product_stocks.location_id
        AND l.tenant_id = public.current_user_tenant_id()
    )
  )
);

-- ============ stock_adjustments (insert tenant scope) ============
DROP POLICY IF EXISTS stock_adj_insert ON public.stock_adjustments;
CREATE POLICY stock_adj_insert ON public.stock_adjustments FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin')
  OR (
    (public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'stock_manager')
      OR public.has_role(auth.uid(), 'cashier'))
    AND EXISTS (
      SELECT 1 FROM public.locations l
      WHERE l.id = stock_adjustments.location_id
        AND l.tenant_id = public.current_user_tenant_id()
    )
  )
);

-- ============ inventory_settings ============
DROP POLICY IF EXISTS inv_settings_select ON public.inventory_settings;
CREATE POLICY inv_settings_select ON public.inventory_settings FOR SELECT TO authenticated
USING (
  tenant_id = public.current_user_tenant_id()
  OR public.has_role(auth.uid(), 'super_admin')
);

-- ============ user_locations ============
DROP POLICY IF EXISTS user_locs_select ON public.user_locations;
DROP POLICY IF EXISTS "Authenticated users can view user locations" ON public.user_locations;
DROP POLICY IF EXISTS "Users can view user_locations" ON public.user_locations;

CREATE POLICY user_locs_select ON public.user_locations FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'super_admin')
  OR EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = user_locations.location_id
      AND l.tenant_id = public.current_user_tenant_id()
  )
);

-- ============ shifts (insert tenant scope) ============
DROP POLICY IF EXISTS shifts_insert ON public.shifts;
CREATE POLICY shifts_insert ON public.shifts FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin')
  OR (
    tenant_id = public.current_user_tenant_id()
    AND (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  )
);

-- ============ user_roles (tenant-scoped admin) ============
DROP POLICY IF EXISTS user_roles_manage ON public.user_roles;
CREATE POLICY user_roles_manage ON public.user_roles FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin')
  OR (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = user_roles.user_id
        AND p.tenant_id = public.current_user_tenant_id()
    )
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin')
  OR (
    public.has_role(auth.uid(), 'admin')
    AND role <> 'super_admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = user_roles.user_id
        AND p.tenant_id = public.current_user_tenant_id()
    )
  )
);

DROP POLICY IF EXISTS user_roles_select ON public.user_roles;
CREATE POLICY user_roles_select ON public.user_roles FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'super_admin')
  OR (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = user_roles.user_id
        AND p.tenant_id = public.current_user_tenant_id()
    )
  )
);

-- ============ role_permissions (super_admin only) ============
DROP POLICY IF EXISTS role_perms_manage ON public.role_permissions;
CREATE POLICY role_perms_manage ON public.role_permissions FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- ============ Storage buckets: tenant-logos & product-images ============
-- Enforce that first folder segment matches caller's tenant_id for writes
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (policyname ILIKE '%tenant-logos%' OR policyname ILIKE '%product-images%' OR policyname ILIKE '%tenant_logos%' OR policyname ILIKE '%product_images%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- Public read remains
CREATE POLICY "tenant-logos public read" ON storage.objects FOR SELECT
USING (bucket_id = 'tenant-logos');

CREATE POLICY "product-images public read" ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

-- Writes restricted to own tenant folder
CREATE POLICY "tenant-logos tenant write" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'tenant-logos'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
      AND (storage.foldername(name))[1] = public.current_user_tenant_id()::text
    )
  )
);

CREATE POLICY "tenant-logos tenant update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'tenant-logos'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
      AND (storage.foldername(name))[1] = public.current_user_tenant_id()::text
    )
  )
);

CREATE POLICY "tenant-logos tenant delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'tenant-logos'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
      AND (storage.foldername(name))[1] = public.current_user_tenant_id()::text
    )
  )
);

CREATE POLICY "product-images tenant write" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
      AND (storage.foldername(name))[1] = public.current_user_tenant_id()::text
    )
  )
);

CREATE POLICY "product-images tenant update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
      AND (storage.foldername(name))[1] = public.current_user_tenant_id()::text
    )
  )
);

CREATE POLICY "product-images tenant delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
      AND (storage.foldername(name))[1] = public.current_user_tenant_id()::text
    )
  )
);
