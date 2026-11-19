-- Security hardening (2026-09-26)
--
-- 1. Sign-up can no longer choose a role or join an existing shop.
-- 2. confirm_user_email / record_tenant_activity are no longer open to anyone.
-- 3. Shops cannot edit their own subscription or fake completed payments.
-- 4. Staff below owner level cannot delete sales or rewrite finished ones.
-- 5. Shop owners cannot reactivate, undelete or re-own their shop record.
-- 6. Shop admins only see roles of people in their own shop.
-- 7. Indexes for foreign keys that had none.

BEGIN;

-- 1 ---------------------------------------------------------------------------
-- New accounts get a profile with no shop. Shops are created by the tenant
-- registration branch; staff are attached by the app server with the service
-- key. Nothing supplied by the person signing up decides a role or a shop.
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

      INSERT INTO public.business_settings (tenant_id, business_name, business_email, business_phone, business_address)
      VALUES (
        _tenant_id,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name',''), 'My Business'),
        NEW.raw_user_meta_data->>'business_email',
        NEW.raw_user_meta_data->>'business_phone',
        NEW.raw_user_meta_data->>'business_address'
      );

      SELECT * INTO _plan FROM public.plans WHERE is_active = true ORDER BY price_monthly ASC LIMIT 1;
      INSERT INTO public.subscriptions (
        tenant_id, plan_id, plan_name, billing_cycle, max_users, max_locations, price,
        status, trial_ends_at, current_period_start, current_period_end
      ) VALUES (
        _tenant_id, _plan.id, COALESCE(_plan.name, 'Basic'), 'monthly',
        COALESCE(_plan.max_users, 3), COALESCE(_plan.max_locations, 1), 0,
        'trialing', now() + interval '14 days', now(), now() + interval '14 days'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed tenant setup for user %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2 ---------------------------------------------------------------------------
-- Confirming an email: platform owner, or a shop owner/manager for someone
-- in their own shop. The app server uses the service key and is unaffected.
CREATE OR REPLACE FUNCTION public.confirm_user_email(_user_id uuid DEFAULT NULL::uuid, _email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _target record;
  _caller uuid := auth.uid();
BEGIN
  IF _user_id IS NOT NULL THEN
    SELECT id, email, email_confirmed_at INTO _target FROM auth.users WHERE id = _user_id LIMIT 1;
  ELSIF _email IS NOT NULL AND _email <> '' THEN
    SELECT id, email, email_confirmed_at INTO _target FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Provide a user_id or email');
  END IF;

  IF _target.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'User not found');
  END IF;

  IF _caller IS NOT NULL AND NOT public.has_role(_caller, 'super_admin') THEN
    IF NOT (public.has_role(_caller, 'admin') OR public.has_role(_caller, 'manager'))
       OR public.current_user_tenant_id() IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.user_id = _target.id AND p.tenant_id = public.current_user_tenant_id()) THEN
      RAISE EXCEPTION 'You can only verify staff in your own shop';
    END IF;
  END IF;

  IF _target.email_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'alreadyVerified', true, 'email', _target.email, 'user_id', _target.id);
  END IF;

  UPDATE auth.users SET email_confirmed_at = now(), updated_at = now() WHERE id = _target.id;
  RETURN jsonb_build_object('ok', true, 'alreadyVerified', false, 'email', _target.email, 'user_id', _target.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_user_email(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_user_email(uuid, text) TO authenticated, service_role;

-- Activity log entries are written by the app, never by visitors.
REVOKE ALL ON FUNCTION public.record_tenant_activity(uuid, uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_tenant_activity(uuid, uuid, text, text, text, text, text, text, jsonb) TO service_role;

-- Trigger-only functions have no business being called over the API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 3 ---------------------------------------------------------------------------
-- Subscriptions are changed by the platform owner and the app server only.
DROP POLICY IF EXISTS subs_update ON public.subscriptions;
CREATE POLICY subs_update ON public.subscriptions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS subs_insert ON public.subscriptions;
CREATE POLICY subs_insert ON public.subscriptions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- A shop may record a payment attempt, but only as pending.
DROP POLICY IF EXISTS sp_insert ON public.subscription_payments;
CREATE POLICY sp_insert ON public.subscription_payments FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (tenant_id = public.current_user_tenant_id() AND status = 'pending')
  );

-- 4 ---------------------------------------------------------------------------
-- The old catch-all policy let cashiers delete and rewrite any sale. Staff keep
-- insert (separate policy) and update, and the trigger below limits updates.
DROP POLICY IF EXISTS transactions_manage ON public.transactions;
CREATE POLICY transactions_staff_update ON public.transactions FOR UPDATE TO authenticated
  USING (
    (tenant_id = public.current_user_tenant_id()
      AND (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'cashier')))
  )
  WITH CHECK (
    (tenant_id = public.current_user_tenant_id()
      AND (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'cashier')))
  );

-- Below owner level, a sale can be changed while it is still pending (the
-- till finishing a payment), or by its own cashier within 15 minutes without
-- touching its status or amount (payment breakdown, M-Pesa reference).
CREATE OR REPLACE FUNCTION public.guard_transaction_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- App server (service key) and database maintenance are not restricted.
  IF _uid IS NULL
     OR public.has_role(_uid, 'super_admin')
     OR public.has_role(_uid, 'admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Only the shop owner can delete sales';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A sale cannot be moved to another shop';
  END IF;

  IF OLD.status = 'pending' THEN
    RETURN NEW;
  END IF;

  IF OLD.cashier_id = _uid
     AND OLD.created_at > now() - interval '15 minutes'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.total IS NOT DISTINCT FROM OLD.total THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only the shop owner can change a finished sale';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_transaction_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_transaction_changes ON public.transactions;
CREATE TRIGGER guard_transaction_changes
  BEFORE UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_transaction_changes();

-- 5 ---------------------------------------------------------------------------
-- Shop owners keep editing their name and logo, but status, deletion,
-- ownership and activation are platform decisions.
CREATE OR REPLACE FUNCTION public.guard_tenant_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.activation_fee_paid_at IS DISTINCT FROM OLD.activation_fee_paid_at THEN
    RAISE EXCEPTION 'Only the platform owner can change the shop status or owner';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_tenant_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_tenant_changes ON public.tenants;
CREATE TRIGGER guard_tenant_changes
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_changes();

-- 6 ---------------------------------------------------------------------------
-- "Users can view own roles" also let every shop admin read every role on the
-- platform. user_roles_select already covers self, own-shop admins and owner.
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;

-- 7 ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_aggregator_audit_events_aggregator_transaction_id ON public.aggregator_audit_events (aggregator_transaction_id);
CREATE INDEX IF NOT EXISTS idx_aggregator_ledger_ref_payout_id ON public.aggregator_ledger (ref_payout_id);
CREATE INDEX IF NOT EXISTS idx_aggregator_ledger_ref_transaction_id ON public.aggregator_ledger (ref_transaction_id);
CREATE INDEX IF NOT EXISTS idx_aggregator_payouts_parent_payout_id ON public.aggregator_payouts (parent_payout_id);
CREATE INDEX IF NOT EXISTS idx_bills_location_id ON public.bills (location_id);
CREATE INDEX IF NOT EXISTS idx_bills_supplier_id ON public.bills (supplier_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_location_id ON public.cash_register (location_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_tenant_id ON public.cash_register (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_location_id ON public.customers (location_id);
CREATE INDEX IF NOT EXISTS idx_delivery_confirmations_delivery_note_id ON public.delivery_confirmations (delivery_note_id);
CREATE INDEX IF NOT EXISTS idx_delivery_confirmations_tenant_id ON public.delivery_confirmations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_customer_id ON public.delivery_notes (customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_invoice_id ON public.delivery_notes (invoice_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_packing_list_id ON public.delivery_notes (packing_list_id);
CREATE INDEX IF NOT EXISTS idx_empties_ledger_customer_id ON public.empties_ledger (customer_id);
CREATE INDEX IF NOT EXISTS idx_empties_ledger_location_id ON public.empties_ledger (location_id);
CREATE INDEX IF NOT EXISTS idx_empties_ledger_product_id ON public.empties_ledger (product_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category_id ON public.expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_location_id ON public.expenses (location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_settings_tenant_id ON public.inventory_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON public.invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_layaways_customer_id ON public.layaways (customer_id);
CREATE INDEX IF NOT EXISTS idx_layaways_location_id ON public.layaways (location_id);
CREATE INDEX IF NOT EXISTS idx_open_bills_customer_id ON public.open_bills (customer_id);
CREATE INDEX IF NOT EXISTS idx_open_bills_location_id ON public.open_bills (location_id);
CREATE INDEX IF NOT EXISTS idx_packing_lists_customer_id ON public.packing_lists (customer_id);
CREATE INDEX IF NOT EXISTS idx_packing_lists_invoice_id ON public.packing_lists (invoice_id);
CREATE INDEX IF NOT EXISTS idx_packing_lists_transaction_id ON public.packing_lists (transaction_id);
CREATE INDEX IF NOT EXISTS idx_payhero_transactions_payout_channel_id ON public.payhero_transactions (payout_channel_id);
CREATE INDEX IF NOT EXISTS idx_product_bundle_items_product_id ON public.product_bundle_items (product_id);
CREATE INDEX IF NOT EXISTS idx_product_bundle_items_variant_id ON public.product_bundle_items (variant_id);
CREATE INDEX IF NOT EXISTS idx_product_stocks_variant_id ON public.product_stocks (variant_id);
CREATE INDEX IF NOT EXISTS idx_product_subcategories_category_id ON public.product_subcategories (category_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON public.purchase_items (product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON public.purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_variant_id ON public.purchase_items (variant_id);
CREATE INDEX IF NOT EXISTS idx_purchases_location_id ON public.purchases (location_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id ON public.purchases (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant_id ON public.purchases (tenant_id);
CREATE INDEX IF NOT EXISTS idx_quotes_customer_id ON public.quotes (customer_id);
CREATE INDEX IF NOT EXISTS idx_sendmoney_payments_tenant_id ON public.sendmoney_payments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sendmoney_stock_errors_payment_id ON public.sendmoney_stock_errors (payment_id);
CREATE INDEX IF NOT EXISTS idx_settlements_bank_account_id ON public.settlements (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_shifts_tenant_id ON public.shifts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_shifts_user_id ON public.shifts (user_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_variant_id ON public.stock_adjustments (variant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_subscription_id ON public.subscription_payments (subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_tenant_id ON public.subscription_payments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON public.subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON public.subscriptions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_domains_tenant_id ON public.tenant_domains (tenant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON public.transactions (customer_id);
CREATE INDEX IF NOT EXISTS idx_variant_exchanges_customer_id ON public.variant_exchanges (customer_id);
CREATE INDEX IF NOT EXISTS idx_variant_exchanges_from_variant_id ON public.variant_exchanges (from_variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_exchanges_location_id ON public.variant_exchanges (location_id);
CREATE INDEX IF NOT EXISTS idx_variant_exchanges_product_id ON public.variant_exchanges (product_id);
CREATE INDEX IF NOT EXISTS idx_variant_exchanges_to_variant_id ON public.variant_exchanges (to_variant_id);

COMMIT;
