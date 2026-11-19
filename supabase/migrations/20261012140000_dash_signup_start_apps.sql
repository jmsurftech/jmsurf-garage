-- Sign-ups for one app (DASH ?app=crm, or JMSURF CALL CENTRE's own sign-up): the chosen
-- apps' 14-day trials start with the company, and single-app use is recorded.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_id uuid;
  _slug text;
  _try_slug text;
  _suffix int;
  _btype public.business_type;
  _plan record;
  _cycle text;
  _trial interval;
  _country text;
  _currency text;
BEGIN
  BEGIN
    INSERT INTO public.profiles (user_id, display_name, tenant_id)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NULL)
    ON CONFLICT (user_id) DO UPDATE
    SET display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name);
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

      BEGIN
        _btype := COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_type',''), 'general')::public.business_type;
      EXCEPTION WHEN OTHERS THEN
        _btype := 'general';
      END;

      INSERT INTO public.tenants (
        business_name, business_email, business_phone, business_address,
        industry, contact_name, contact_email, contact_phone, owner_user_id, slug,
        activation_fee_paid_at, business_type
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
        _try_slug,
        now(),
        _btype
      ) RETURNING id INTO _tenant_id;

      UPDATE public.profiles SET tenant_id = _tenant_id WHERE user_id = NEW.id;
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;

      -- Country and currency chosen at registration (checked, with safe defaults).
      _country := upper(COALESCE(NEW.raw_user_meta_data->>'country', ''));
      IF _country !~ '^[A-Z]{2}$' THEN _country := 'KE'; END IF;
      _currency := upper(COALESCE(NEW.raw_user_meta_data->>'currency', ''));
      IF _currency !~ '^[A-Z]{3}$' THEN _currency := 'KES'; END IF;

      INSERT INTO public.business_settings (tenant_id, business_name, business_email, business_phone, business_address, country, currency)
      VALUES (
        _tenant_id,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name',''), 'My Business'),
        NEW.raw_user_meta_data->>'business_email',
        NEW.raw_user_meta_data->>'business_phone',
        NEW.raw_user_meta_data->>'business_address',
        _country,
        _currency
      );

      -- The package chosen when the shop was created (admin), else the entry package.
      BEGIN
        SELECT * INTO _plan FROM public.plans
         WHERE is_active = true AND id = NULLIF(NEW.raw_user_meta_data->>'plan_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN _plan := NULL;
      END;
      IF _plan.id IS NULL THEN
        SELECT * INTO _plan FROM public.plans WHERE is_active = true ORDER BY price_monthly ASC LIMIT 1;
      END IF;
      _cycle := COALESCE(NULLIF(NEW.raw_user_meta_data->>'billing_cycle', ''), 'monthly');
      IF _cycle NOT IN ('monthly', 'quarterly', 'semi_annually', 'annually') THEN _cycle := 'monthly'; END IF;
      _trial := make_interval(days => GREATEST(1, COALESCE(_plan.trial_days, 14)));
      INSERT INTO public.subscriptions (
        tenant_id, plan_id, plan_name, billing_cycle, max_users, max_locations, price,
        status, trial_ends_at, current_period_start, current_period_end
      ) VALUES (
        _tenant_id, _plan.id, COALESCE(_plan.name, 'Basic'), _cycle,
        COALESCE(_plan.max_users, 3), COALESCE(_plan.max_locations, 1), COALESCE(_plan.price_monthly, 0),
        'trialing', now() + _trial, now(), now() + _trial
      );

      -- Apps chosen at sign-up start their trial now; one chosen app = single-app use.
      BEGIN
        INSERT INTO public.tenant_modules (tenant_id, module_key, status, price_monthly, trial_ends_at, activated_by)
        SELECT _tenant_id, m.key, 'trial', m.price_monthly, now() + interval '14 days', NEW.id
          FROM public.platform_modules m
         WHERE m.is_active AND NOT m.included
           AND m.key IN (SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(NEW.raw_user_meta_data->'start_apps') = 'array' THEN NEW.raw_user_meta_data->'start_apps' ELSE '[]'::jsonb END))
        ON CONFLICT DO NOTHING;
        UPDATE public.business_settings
           SET erp_settings = coalesce(erp_settings, '{}'::jsonb) || jsonb_build_object('start_applied', true)
                 || CASE WHEN NULLIF(NEW.raw_user_meta_data->>'focus_app', '') IS NOT NULL
                         THEN jsonb_build_object('focus_app', NEW.raw_user_meta_data->>'focus_app') ELSE '{}'::jsonb END
         WHERE tenant_id = _tenant_id AND jsonb_typeof(NEW.raw_user_meta_data->'start_apps') = 'array';
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Start apps for %: %', NEW.id, SQLERRM;
      END;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed tenant setup for user %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$

;
