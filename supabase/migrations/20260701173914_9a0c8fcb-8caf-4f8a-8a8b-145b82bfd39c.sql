
-- 1. Restrict bill_categories and expense_categories writes to super_admin only
DROP POLICY IF EXISTS bill_cats_manage ON public.bill_categories;
CREATE POLICY bill_cats_manage ON public.bill_categories
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS exp_cats_manage ON public.expense_categories;
CREATE POLICY exp_cats_manage ON public.expense_categories
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- 2. Tighten user_roles_manage: apply role restriction to USING as well, and prevent self-modification
DROP POLICY IF EXISTS user_roles_manage ON public.user_roles;
CREATE POLICY user_roles_manage ON public.user_roles
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'admin')
      AND user_id <> auth.uid()
      AND role NOT IN ('super_admin'::app_role, 'admin'::app_role)
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
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'admin')
      AND user_id <> auth.uid()
      AND role NOT IN ('super_admin'::app_role, 'admin'::app_role)
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
