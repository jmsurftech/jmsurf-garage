
-- Fix 1: Restrict stock_adjustments INSERT to authenticated role only
DROP POLICY IF EXISTS stock_adj_insert ON public.stock_adjustments;
CREATE POLICY stock_adj_insert ON public.stock_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role) OR (
      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role))
      AND EXISTS (SELECT 1 FROM public.locations l WHERE l.id = stock_adjustments.location_id AND l.tenant_id = current_user_tenant_id())
      AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = stock_adjustments.product_id AND p.tenant_id = current_user_tenant_id())
    )
  );

-- Fix 2: Tighten user_roles_manage so admins can only manage roles for users
-- who are explicitly members of their tenant (positive check), AND who do not
-- have any profile in another tenant.
DROP POLICY IF EXISTS user_roles_manage ON public.user_roles;
CREATE POLICY user_roles_manage ON public.user_roles
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role) OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND current_user_tenant_id() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = user_roles.user_id
          AND p.tenant_id = current_user_tenant_id()
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles p2
        WHERE p2.user_id = user_roles.user_id
          AND (p2.tenant_id IS DISTINCT FROM current_user_tenant_id() OR p2.tenant_id IS NULL)
      )
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role) OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND role <> 'super_admin'::app_role
      AND role <> 'admin'::app_role
      AND current_user_tenant_id() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = user_roles.user_id
          AND p.tenant_id = current_user_tenant_id()
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles p2
        WHERE p2.user_id = user_roles.user_id
          AND (p2.tenant_id IS DISTINCT FROM current_user_tenant_id() OR p2.tenant_id IS NULL)
      )
    )
  );
