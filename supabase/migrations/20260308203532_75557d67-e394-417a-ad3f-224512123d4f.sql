
-- Update handle_new_user to save slug
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
  _plan_name text;
  _trial_days int;
  _trial_end timestamptz;
  _slug text;
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  IF NEW.raw_user_meta_data->>'registration_type' = 'tenant' THEN
    _slug := COALESCE(NEW.raw_user_meta_data->>'store_slug', '');
    
    INSERT INTO public.tenants (
      business_name, business_email, business_phone, business_address,
      industry, contact_name, contact_email, contact_phone, owner_user_id, slug
    ) VALUES (
      COALESCE(NEW.raw_user_meta_data->>'business_name', ''),
      NEW.raw_user_meta_data->>'business_email',
      NEW.raw_user_meta_data->>'business_phone',
      NEW.raw_user_meta_data->>'business_address',
      NEW.raw_user_meta_data->>'industry',
      COALESCE(NEW.raw_user_meta_data->>'contact_name', NEW.email),
      COALESCE(NEW.raw_user_meta_data->>'contact_email', NEW.email),
      NEW.raw_user_meta_data->>'contact_phone',
      NEW.id,
      NULLIF(_slug, '')
    ) RETURNING id INTO _tenant_id;

    UPDATE public.profiles SET tenant_id = _tenant_id WHERE user_id = NEW.id;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');

    _billing := COALESCE(NEW.raw_user_meta_data->>'billing_cycle', 'monthly');
    _custom_users := COALESCE((NEW.raw_user_meta_data->>'custom_users')::int, 0);
    _plan_id := NULL;
    _trial_days := 7;

    IF _custom_users > 0 THEN
      _max_users := _custom_users;
      _plan_name := 'Custom (' || _custom_users || ' users)';
      _price := _custom_users * 250;
      IF _billing = 'quarterly' THEN _price := round(_price * 3 * 0.9); END IF;
      IF _billing = 'annually' THEN _price := round(_price * 12 * 0.8); END IF;
    ELSE
      _plan_id := (NEW.raw_user_meta_data->>'plan_id')::uuid;
      SELECT * INTO _plan FROM public.plans WHERE id = _plan_id;
      IF _plan.id IS NOT NULL THEN
        _max_users := _plan.max_users;
        _plan_name := _plan.name;
        _trial_days := COALESCE(_plan.trial_days, 7);
        IF _billing = 'quarterly' THEN _price := _plan.price_quarterly;
        ELSIF _billing = 'annually' THEN _price := _plan.price_annually;
        ELSE _price := _plan.price_monthly;
        END IF;
      ELSE
        _max_users := 2;
        _plan_name := 'Starter';
        _price := 500;
      END IF;
    END IF;

    _trial_end := now() + (_trial_days || ' days')::interval;

    INSERT INTO public.subscriptions (
      tenant_id, plan_id, plan_name, billing_cycle, max_users, price,
      status, trial_ends_at, current_period_start, current_period_end
    ) VALUES (
      _tenant_id, _plan_id, _plan_name, _billing, _max_users, _price,
      'trial', _trial_end, now(), _trial_end
    );

  ELSIF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cashier');
  END IF;

  RETURN NEW;
END;
$function$;
