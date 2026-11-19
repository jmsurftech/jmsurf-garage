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

      INSERT INTO public.business_settings (tenant_id, business_name, business_email, business_phone, business_address)
      VALUES (
        _tenant_id,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name',''), 'My Business'),
        NEW.raw_user_meta_data->>'business_email',
        NEW.raw_user_meta_data->>'business_phone',
        NEW.raw_user_meta_data->>'business_address'
      );

      INSERT INTO public.subscriptions (
        tenant_id, plan_id, plan_name, billing_cycle, max_users, max_locations, price,
        status, trial_ends_at, current_period_start, current_period_end
      ) VALUES (
        _tenant_id, NULL, 'Free', 'monthly', 999999, 999999, 0,
        'active', NULL, now(), now() + interval '100 years'
      );

      -- New shops start lean: only the core screens are on. Everything else can
      -- be switched on per shop from the admin panel.
      BEGIN
        INSERT INTO public.tenant_feature_overrides (tenant_id, features)
        VALUES (
          _tenant_id,
          jsonb_build_object(
            'dashboard', true,
            'sales', true,
            'purchases', true,
            'reports', true,
            'staff', true,
            'smtp_email', true,
            'theme', true,
            'session', true,
            'communication', true,
            'customers', false,
            'suppliers', false,
            'invoices', false,
            'quotes', false,
            'bills', false,
            'expenses', false,
            'inventory_transfer', false,
            'roles', false
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Feature defaults failed for tenant %: %', _tenant_id, SQLERRM;
      END;
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