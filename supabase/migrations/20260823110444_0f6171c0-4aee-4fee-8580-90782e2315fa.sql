DROP EVENT TRIGGER IF EXISTS ensure_rls_helper_grants_trg;
DROP FUNCTION IF EXISTS public.ensure_rls_helper_grants();

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

CREATE TABLE IF NOT EXISTS public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'landing_cta',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT INSERT ON public.leads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_public_insert" ON public.leads;
CREATE POLICY "leads_public_insert" ON public.leads
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(btrim(name)) BETWEEN 2 AND 100
    AND length(btrim(phone)) BETWEEN 7 AND 20
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND length(email) <= 254
    AND (notes IS NULL OR length(notes) <= 2000)
    AND source = 'landing_cta'
  );

DROP POLICY IF EXISTS "leads_super_admin_manage" ON public.leads;
CREATE POLICY "leads_super_admin_manage" ON public.leads
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads (created_at DESC);

INSERT INTO public.cms_content (section, content)
VALUES ('whatsapp', '{"enabled": true, "number": "254712504593", "message": "Hello JMSURF POS, I would like to know more about your point of sale system.", "label": "Chat with us on WhatsApp"}'::jsonb)
ON CONFLICT (section) DO NOTHING;