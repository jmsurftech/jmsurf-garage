-- 1) Lowercase existing tenant slugs to avoid case-sensitivity gotchas
UPDATE public.tenants SET slug = lower(slug) WHERE slug IS NOT NULL AND slug <> lower(slug);

-- 2) Enforce lowercase going forward
CREATE OR REPLACE FUNCTION public.lowercase_tenant_slug()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.slug IS NOT NULL THEN
    NEW.slug := lower(NEW.slug);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lowercase_tenant_slug ON public.tenants;
CREATE TRIGGER trg_lowercase_tenant_slug
BEFORE INSERT OR UPDATE OF slug ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.lowercase_tenant_slug();

-- 3) Audit log table for cross-tenant URL access attempts (super_admin only)
CREATE TABLE IF NOT EXISTS public.tenant_access_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_email TEXT,
  user_tenant_id UUID,
  user_tenant_slug TEXT,
  attempted_url TEXT NOT NULL,
  attempted_slug TEXT,
  redirected_to TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_access_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS taa_insert_authenticated ON public.tenant_access_audit;
CREATE POLICY taa_insert_authenticated ON public.tenant_access_audit
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS taa_select_super_admin ON public.tenant_access_audit;
CREATE POLICY taa_select_super_admin ON public.tenant_access_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_taa_created ON public.tenant_access_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_taa_user ON public.tenant_access_audit (user_id);