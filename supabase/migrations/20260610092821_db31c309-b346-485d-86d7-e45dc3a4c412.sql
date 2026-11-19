DROP POLICY IF EXISTS "Service role can read suppressed emails" ON public.suppressed_emails;
DROP POLICY IF EXISTS "Service role can insert suppressed emails" ON public.suppressed_emails;
DROP POLICY IF EXISTS deny_select_anon ON public.suppressed_emails;
DROP POLICY IF EXISTS deny_select_authenticated ON public.suppressed_emails;

CREATE POLICY "Service role can read suppressed emails"
ON public.suppressed_emails
FOR SELECT
TO service_role
USING (true);

CREATE POLICY "Service role can insert suppressed emails"
ON public.suppressed_emails
FOR INSERT
TO service_role
WITH CHECK (true);