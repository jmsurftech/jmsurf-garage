-- Fix role escalation: prevent tenant admins from assigning super_admin role
DROP POLICY IF EXISTS "user_roles_manage" ON public.user_roles;
CREATE POLICY "user_roles_manage" ON public.user_roles
  AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) AND role <> 'super_admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );