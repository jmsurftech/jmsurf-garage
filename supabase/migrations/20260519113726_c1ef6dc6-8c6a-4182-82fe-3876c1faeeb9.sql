
DROP POLICY IF EXISTS email_logs_insert ON public.email_logs;
CREATE POLICY email_logs_insert
ON public.email_logs
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'super_admin'::app_role)
  OR (
    tenant_id = current_user_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
  )
);
