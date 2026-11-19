CREATE POLICY deny_select_anon
ON public.suppressed_emails
FOR SELECT
TO anon
USING (false);