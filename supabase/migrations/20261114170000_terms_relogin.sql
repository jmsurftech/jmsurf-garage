-- Companies created before the terms were recorded: the owner or an admin accepts the
-- current Terms of Service and Privacy Policy once, at the next sign-in. Saved only
-- through accept_company_terms() (server clock, source 'relogin'), never a direct update.

-- The platform's demo company is exempt, as at sign-up.
UPDATE public.tenants
   SET terms_accepted_at = now(), terms_version = public.current_terms_version(), terms_source = 'demo'
 WHERE slug = 'demo' AND terms_version IS NULL;

-- Owner of the company, or an active admin / owner member of it.
CREATE OR REPLACE FUNCTION public.can_accept_company_terms(p_tenant uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant AND t.owner_user_id = p_user)
      OR EXISTS (SELECT 1 FROM public.tenant_members m
                  WHERE m.tenant_id = p_tenant AND m.user_id = p_user AND m.status = 'active'
                    AND (m.is_owner OR m.role = 'admin'))
$$;

-- For the signed-in user's current company: must the terms still be accepted, and may this user do it?
CREATE OR REPLACE FUNCTION public.my_terms_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _t record;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('needed', false); END IF;
  SELECT tn.id, tn.slug, tn.business_name, tn.terms_version INTO _t
    FROM public.profiles p JOIN public.tenants tn ON tn.id = p.tenant_id
   WHERE p.user_id = _uid;
  IF _t.id IS NULL OR _t.slug = 'demo' OR coalesce(_t.terms_version, '') = public.current_terms_version() THEN
    RETURN jsonb_build_object('needed', false);
  END IF;
  RETURN jsonb_build_object('needed', true, 'version', public.current_terms_version(), 'company', _t.business_name,
                            'can_accept', public.can_accept_company_terms(_t.id, _uid));
END $$;

CREATE OR REPLACE FUNCTION public.accept_company_terms(p_version text, p_marketing boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid;
  _mkt boolean := coalesce(p_marketing, false);
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Please sign in again' USING ERRCODE = '28000'; END IF;
  IF coalesce(p_version, '') <> public.current_terms_version() THEN
    RAISE EXCEPTION 'TERMS_VERSION: these terms have been updated, reload the page' USING ERRCODE = 'check_violation';
  END IF;
  SELECT tenant_id INTO _tenant FROM public.profiles WHERE user_id = _uid;
  IF _tenant IS NULL OR NOT public.can_accept_company_terms(_tenant, _uid) THEN
    RAISE EXCEPTION 'NOT_ALLOWED: only the company owner or an admin can accept the terms' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tenants SET
    terms_accepted_at = now(),
    terms_version = public.current_terms_version(),
    terms_source = 'relogin',
    marketing_opt_in = _mkt,
    marketing_opt_in_at = CASE WHEN _mkt THEN now() END
  WHERE id = _tenant;
  RETURN jsonb_build_object('ok', true, 'version', public.current_terms_version());
END $$;

-- The terms and marketing columns can not be changed by a direct client update
-- (owners may update their company row for other fields): they keep their values.
CREATE OR REPLACE FUNCTION public.tenants_terms_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.terms_accepted_at := OLD.terms_accepted_at;
    NEW.terms_version := OLD.terms_version;
    NEW.terms_source := OLD.terms_source;
    NEW.marketing_opt_in := OLD.marketing_opt_in;
    NEW.marketing_opt_in_at := OLD.marketing_opt_in_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tenants_terms_guard ON public.tenants;
CREATE TRIGGER tenants_terms_guard BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_terms_guard();

REVOKE ALL ON FUNCTION public.can_accept_company_terms(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_terms_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_company_terms(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_terms_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_company_terms(text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
