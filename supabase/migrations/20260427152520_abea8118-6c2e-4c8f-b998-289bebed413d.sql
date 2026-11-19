-- Allow authenticated tenant owners (admin/manager) to insert their own aggregator merchant record
DROP POLICY IF EXISTS agg_tenants_owner_insert ON public.aggregator_tenants;
CREATE POLICY agg_tenants_owner_insert
  ON public.aggregator_tenants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

-- Broaden update policy to allow admins/managers (still restricted to their own row)
DROP POLICY IF EXISTS agg_tenants_owner_update ON public.aggregator_tenants;
CREATE POLICY agg_tenants_owner_update
  ON public.aggregator_tenants
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );