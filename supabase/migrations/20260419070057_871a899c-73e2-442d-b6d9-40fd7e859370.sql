
-- 1. Add soft-delete column to tenants
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_tenants_deleted_at ON public.tenants(deleted_at);

-- 2. Recreate FK constraints with ON DELETE CASCADE for full delete
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE confrelid = 'public.tenants'::regclass
      AND contype = 'f'
      AND conname IN (
        'bills_tenant_id_fkey','business_settings_tenant_id_fkey','cash_register_tenant_id_fkey',
        'customers_tenant_id_fkey','delivery_confirmations_tenant_id_fkey','delivery_notes_tenant_id_fkey',
        'expenses_tenant_id_fkey','inventory_settings_tenant_id_fkey','invoices_tenant_id_fkey',
        'locations_tenant_id_fkey','packing_lists_tenant_id_fkey','products_tenant_id_fkey',
        'purchases_tenant_id_fkey','quotes_tenant_id_fkey','services_tenant_id_fkey',
        'shifts_tenant_id_fkey','suppliers_tenant_id_fkey','transactions_tenant_id_fkey',
        'profiles_tenant_id_fkey'
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.bills ADD CONSTRAINT bills_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.cash_register ADD CONSTRAINT cash_register_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.customers ADD CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.delivery_confirmations ADD CONSTRAINT delivery_confirmations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.delivery_notes ADD CONSTRAINT delivery_notes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.inventory_settings ADD CONSTRAINT inventory_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.locations ADD CONSTRAINT locations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.packing_lists ADD CONSTRAINT packing_lists_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD CONSTRAINT products_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.services ADD CONSTRAINT services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;

-- 3. Make handle_new_user resilient — never fail the auth signup
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
  _try_slug text;
  _suffix int;
BEGIN
  -- Always create profile (cannot fail)
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
      -- Auto-resolve slug conflicts
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

      IF _custom_users > 0 THEN
        _max_users := _custom_users;
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
          _plan_name := _plan.name;
          _trial_days := COALESCE(_plan.trial_days, 7);
          IF _billing = 'quarterly' THEN _price := _plan.price_quarterly;
          ELSIF _billing = 'annually' THEN _price := _plan.price_annually;
          ELSE _price := _plan.price_monthly;
          END IF;
        ELSE
          _max_users := 2; _plan_name := 'Starter'; _price := 500;
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

-- 4. Ensure trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
