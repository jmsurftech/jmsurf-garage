-- 1. plans: add max_locations + reset features default to flag map
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_locations integer NOT NULL DEFAULT 1;

-- Convert any plans whose features is currently an array to a default flag object (preserve existing if already object)
UPDATE public.plans
SET features = '{
  "sales": true,
  "purchases": true,
  "roles": true,
  "communication": true,
  "smtp_email": true,
  "sms": false,
  "whatsapp": false,
  "theme": true,
  "session": true,
  "reports": true,
  "staff": true,
  "inventory_transfer": true,
  "dashboard": true,
  "customers": true,
  "suppliers": true,
  "invoices": true,
  "quotes": true,
  "bills": true,
  "expenses": true
}'::jsonb
WHERE jsonb_typeof(features) <> 'object';

-- 2. subscriptions: add max_locations
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS max_locations integer NOT NULL DEFAULT 1;

-- Backfill subscriptions.max_locations from their plan if available
UPDATE public.subscriptions s
SET max_locations = COALESCE(p.max_locations, 1)
FROM public.plans p
WHERE s.plan_id = p.id AND s.max_locations = 1;

-- 3. tenant_feature_overrides: per-tenant flag overrides
CREATE TABLE IF NOT EXISTS public.tenant_feature_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_feature_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tfo_super_manage ON public.tenant_feature_overrides;
CREATE POLICY tfo_super_manage
ON public.tenant_feature_overrides
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS tfo_tenant_select ON public.tenant_feature_overrides;
CREATE POLICY tfo_tenant_select
ON public.tenant_feature_overrides
FOR SELECT
TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER tenant_feature_overrides_updated_at
BEFORE UPDATE ON public.tenant_feature_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();