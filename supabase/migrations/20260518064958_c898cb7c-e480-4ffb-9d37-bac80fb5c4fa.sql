
-- 1) aggregator_tenants: restrict SELECT to owner or super_admin
CREATE POLICY "agg_tenants_owner_select"
ON public.aggregator_tenants
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'::app_role));

-- 2) storage: drop legacy unscoped tenant-logos policies
DROP POLICY IF EXISTS "Authenticated users can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete logos" ON storage.objects;

-- 3) storage: drop legacy unscoped taxonomy-images policies
DROP POLICY IF EXISTS "Authenticated write taxonomy-images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update taxonomy-images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete taxonomy-images" ON storage.objects;

-- 4) user_locations: consolidate manage policies with tenant scoping
DROP POLICY IF EXISTS "Admins can manage user_locations" ON public.user_locations;
DROP POLICY IF EXISTS "Staff can manage user locations" ON public.user_locations;
DROP POLICY IF EXISTS "user_locs_manage" ON public.user_locations;

CREATE POLICY "user_locs_manage"
ON public.user_locations
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR (
    (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'manager'::app_role))
    AND EXISTS (
      SELECT 1 FROM public.locations l
      WHERE l.id = user_locations.location_id
        AND l.tenant_id = public.current_user_tenant_id()
    )
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR (
    (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'manager'::app_role))
    AND EXISTS (
      SELECT 1 FROM public.locations l
      WHERE l.id = user_locations.location_id
        AND l.tenant_id = public.current_user_tenant_id()
    )
  )
);

-- 5) purchase_items: enforce tenant scope on manage
DROP POLICY IF EXISTS "purch_items_manage" ON public.purchase_items;

CREATE POLICY "purch_items_manage"
ON public.purchase_items
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR (
    (public.has_role(auth.uid(), 'admin'::app_role)
     OR public.has_role(auth.uid(), 'manager'::app_role)
     OR public.has_role(auth.uid(), 'stock_manager'::app_role))
    AND EXISTS (
      SELECT 1 FROM public.purchases p
      WHERE p.id = purchase_items.purchase_id
        AND p.tenant_id = public.current_user_tenant_id()
    )
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR (
    (public.has_role(auth.uid(), 'admin'::app_role)
     OR public.has_role(auth.uid(), 'manager'::app_role)
     OR public.has_role(auth.uid(), 'stock_manager'::app_role))
    AND EXISTS (
      SELECT 1 FROM public.purchases p
      WHERE p.id = purchase_items.purchase_id
        AND p.tenant_id = public.current_user_tenant_id()
    )
  )
);
