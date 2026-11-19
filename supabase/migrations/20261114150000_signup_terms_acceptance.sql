-- Company sign-up: the Terms of Service and Privacy Policy must be accepted.
-- Checked by the database (not only by the sign-up page), and the acceptance is
-- kept on the company with the terms version, its source and the server time.
-- Marketing consent is a separate, optional choice (default: no).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS terms_source text,
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at timestamptz;

-- The terms version a new company must accept. Change it together with
-- TERMS_VERSION in src/pages/Register.tsx (and demo.js, admin-create-tenant).
CREATE OR REPLACE FUNCTION public.current_terms_version()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT '2026-11-14'::text $$;

-- BEFORE INSERT on auth.users: a company sign-up without acceptance is refused.
CREATE OR REPLACE FUNCTION public.signup_terms_required()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'registration_type' = 'tenant' THEN
    IF coalesce(NEW.raw_user_meta_data->>'terms_accepted', '') <> 'true'
       OR coalesce(NEW.raw_user_meta_data->>'terms_version', '') <> public.current_terms_version() THEN
      RAISE EXCEPTION 'TERMS_NOT_ACCEPTED: accept the Terms of Service and Privacy Policy to create a company'
        USING ERRCODE = 'check_violation';
    END IF;
    -- The server's clock, never the browser's.
    NEW.raw_user_meta_data := NEW.raw_user_meta_data || jsonb_build_object('terms_accepted_at', now());
  END IF;
  RETURN NEW;
END $$;

-- AFTER INSERT on auth.users (runs after on_auth_user_created, which makes the
-- company): writes the acceptance and the marketing choice onto the company.
CREATE OR REPLACE FUNCTION public.signup_terms_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _mkt boolean := coalesce(NEW.raw_user_meta_data->>'marketing_opt_in', '') = 'true';
BEGIN
  IF NEW.raw_user_meta_data->>'registration_type' = 'tenant' THEN
    UPDATE public.tenants SET
      terms_accepted_at = coalesce((NEW.raw_user_meta_data->>'terms_accepted_at')::timestamptz, now()),
      terms_version = NEW.raw_user_meta_data->>'terms_version',
      terms_source = left(coalesce(nullif(NEW.raw_user_meta_data->>'terms_source', ''), 'signup'), 20),
      marketing_opt_in = _mkt,
      marketing_opt_in_at = CASE WHEN _mkt THEN now() END
    WHERE owner_user_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.signup_terms_required() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.signup_terms_record() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS signup_terms_required ON auth.users;
CREATE TRIGGER signup_terms_required BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.signup_terms_required();

-- Trigger names run in alphabetical order: "signup_…" comes after "on_auth_user_created".
DROP TRIGGER IF EXISTS signup_terms_record ON auth.users;
CREATE TRIGGER signup_terms_record AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.signup_terms_record();

NOTIFY pgrst, 'reload schema';
