CREATE POLICY deny_select_anon_restrictive
ON public.suppressed_emails
AS RESTRICTIVE
FOR SELECT
TO anon
USING (false);

CREATE POLICY deny_select_authenticated_restrictive
ON public.suppressed_emails
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (false);