CREATE POLICY deny_select_authenticated
ON public.suppressed_emails
FOR SELECT
TO authenticated
USING (false);