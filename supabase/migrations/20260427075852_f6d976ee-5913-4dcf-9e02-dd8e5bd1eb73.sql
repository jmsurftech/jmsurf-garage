-- Tenant-scoped activity log: tracks user actions across the whole system
CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID,
  user_email TEXT,
  user_display_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  description TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_log_tenant_created
  ON public.user_activity_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_user
  ON public.user_activity_log (user_id);

ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;

-- Tenant members can insert their own activity rows
CREATE POLICY "Members insert own tenant activity"
  ON public.user_activity_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_user_tenant_id()
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- Tenant admins (and super-admins) can read their tenant's activity
CREATE POLICY "Admins read tenant activity"
  ON public.user_activity_log
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      tenant_id = public.current_user_tenant_id()
      AND public.has_role(auth.uid(), 'admin')
    )
  );