-- Allow any authenticated tenant member to read their OWN activity log entries.
-- Admins (and super-admins) keep their existing tenant-wide read access.
CREATE POLICY "Members read own activity"
  ON public.user_activity_log
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND tenant_id = public.current_user_tenant_id()
  );