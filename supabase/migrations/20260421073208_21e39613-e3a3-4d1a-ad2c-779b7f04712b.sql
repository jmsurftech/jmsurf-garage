CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_id uuid;
  _plan_id uuid;
  _plan record;
  _billing text;
  _custom_users int;
  _price numeric;
  _max_users int;
  _max_locations int;
  _plan_name text;
  _trial_days int;
  _trial_end timestamptz;
  _slug text;
  _try_slug text;
  _suffix int;
BEGIN
  BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to create profile for %: %', NEW.id, SQLERRM;
  END;

  IF NEW.raw_user_meta_data->>'registration_type' = 'tenant' THEN
    BEGIN
      _slug := COALESCE(NEW.raw_user_meta_data->>'store_slug', '');
      _try_slug := NULLIF(_slug, '');
      _suffix := 1;
      WHILE _try_slug IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants WHERE slug = _try_slug) LOOP
        _try_slug := _slug || '-' || _suffix;
        _suffix := _suffix + 1;
        EXIT WHEN _suffix > 50;
      END LOOP;

      INSERT INTO public.tenants (
        business_name, business_email, business_phone, business_address,
        industry, contact_name, contact_email, contact_phone, owner_user_id, slug
      ) VALUES (
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name',''), 'My Business'),
        NEW.raw_user_meta_data->>'business_email',
        NEW.raw_user_meta_data->>'business_phone',
        NEW.raw_user_meta_data->>'business_address',
        NEW.raw_user_meta_data->>'industry',
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'contact_name',''), NEW.email),
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'contact_email',''), NEW.email),
        NEW.raw_user_meta_data->>'contact_phone',
        NEW.id,
        _try_slug
      ) RETURNING id INTO _tenant_id;

      UPDATE public.profiles SET tenant_id = _tenant_id WHERE user_id = NEW.id;
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;

      INSERT INTO public.business_settings (tenant_id, business_name, business_email, business_phone, business_address)
      VALUES (
        _tenant_id,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name',''), 'My Business'),
        NEW.raw_user_meta_data->>'business_email',
        NEW.raw_user_meta_data->>'business_phone',
        NEW.raw_user_meta_data->>'business_address'
      );

      _billing := COALESCE(NEW.raw_user_meta_data->>'billing_cycle', 'monthly');
      _custom_users := COALESCE((NEW.raw_user_meta_data->>'custom_users')::int, 0);
      _plan_id := NULL;
      _trial_days := 7;
      _max_locations := 1;

      IF _custom_users > 0 THEN
        _max_users := _custom_users;
        _max_locations := 1;
        _plan_name := 'Custom (' || _custom_users || ' users)';
        _price := _custom_users * 250;
        IF _billing = 'quarterly' THEN _price := round(_price * 3 * 0.9); END IF;
        IF _billing = 'annually' THEN _price := round(_price * 12 * 0.8); END IF;
      ELSE
        BEGIN
          _plan_id := NULLIF(NEW.raw_user_meta_data->>'plan_id','')::uuid;
        EXCEPTION WHEN OTHERS THEN _plan_id := NULL;
        END;
        SELECT * INTO _plan FROM public.plans WHERE id = _plan_id;
        IF _plan.id IS NOT NULL THEN
          _max_users := _plan.max_users;
          _max_locations := COALESCE(_plan.max_locations, 1);
          _plan_name := _plan.name;
          _trial_days := COALESCE(_plan.trial_days, 7);
          IF _billing = 'quarterly' THEN _price := _plan.price_quarterly;
          ELSIF _billing = 'annually' THEN _price := _plan.price_annually;
          ELSE _price := _plan.price_monthly;
          END IF;
        ELSE
          _max_users := 2;
          _max_locations := 1;
          _plan_name := 'Starter';
          _price := 500;
        END IF;
      END IF;

      _trial_end := now() + (_trial_days || ' days')::interval;
      INSERT INTO public.subscriptions (
        tenant_id, plan_id, plan_name, billing_cycle, max_users, max_locations, price,
        status, trial_ends_at, current_period_start, current_period_end
      ) VALUES (
        _tenant_id, _plan_id, _plan_name, _billing, _max_users, _max_locations, _price,
        'trial', _trial_end, now(), _trial_end
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Tenant setup failed for user %: %', NEW.id, SQLERRM;
    END;
  ELSIF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cashier') ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_plan_subscriptions(_plan_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _affected integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.subscriptions s
  SET
    plan_name = p.name,
    max_users = p.max_users,
    max_locations = p.max_locations,
    updated_at = now()
  FROM public.plans p
  WHERE s.plan_id = p.id
    AND p.id = _plan_id;

  GET DIAGNOSTICS _affected = ROW_COUNT;
  RETURN _affected;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_plan_subscriptions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_plan_subscriptions(uuid) TO authenticated;