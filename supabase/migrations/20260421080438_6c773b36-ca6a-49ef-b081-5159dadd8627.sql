-- Audit log for plan/override feature changes
CREATE TABLE IF NOT EXISTS public.feature_audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_user_id UUID,
  actor_email TEXT,
  scope TEXT NOT NULL, -- 'plan' | 'tenant_override'
  plan_id UUID,
  tenant_id UUID,
  before_features JSONB,
  after_features JSONB,
  effective_before JSONB,
  effective_after JSONB,
  diff JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fal_tenant ON public.feature_audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fal_plan ON public.feature_audit_logs(plan_id, created_at DESC);

ALTER TABLE public.feature_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fal_select_super_admin"
  ON public.feature_audit_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "fal_insert_super_admin"
  ON public.feature_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Helper RPC: returns the canonical list of allowed feature keys so backend
-- (and clients) can sanitize unknown keys before merging.
CREATE OR REPLACE FUNCTION public.allowed_feature_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'sales','purchases','roles','communication','smtp_email',
    'sms','whatsapp','theme','session','reports','staff',
    'inventory_transfer','dashboard','customers','suppliers',
    'invoices','quotes','bills','expenses'
  ]::text[];
$$;

-- Trigger to strip unknown keys from plans.features and tenant_feature_overrides.features
CREATE OR REPLACE FUNCTION public.sanitize_feature_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _allowed TEXT[];
  _key TEXT;
  _val JSONB;
  _clean JSONB := '{}'::jsonb;
BEGIN
  _allowed := public.allowed_feature_keys();
  -- Only sanitize when features is a JSON object (not an array/string)
  IF NEW.features IS NOT NULL AND jsonb_typeof(NEW.features) = 'object' THEN
    FOR _key, _val IN SELECT * FROM jsonb_each(NEW.features) LOOP
      IF _key = ANY(_allowed) AND jsonb_typeof(_val) = 'boolean' THEN
        _clean := _clean || jsonb_build_object(_key, _val);
      END IF;
    END LOOP;
    NEW.features := _clean;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sanitize_plan_features ON public.plans;
CREATE TRIGGER trg_sanitize_plan_features
  BEFORE INSERT OR UPDATE OF features ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.sanitize_feature_flags();

DROP TRIGGER IF EXISTS trg_sanitize_override_features ON public.tenant_feature_overrides;
CREATE TRIGGER trg_sanitize_override_features
  BEFORE INSERT OR UPDATE OF features ON public.tenant_feature_overrides
  FOR EACH ROW EXECUTE FUNCTION public.sanitize_feature_flags();