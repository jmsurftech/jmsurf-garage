-- Lock internal audit helper to trusted backend role only
REVOKE ALL ON FUNCTION public.record_tenant_activity(uuid, uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_tenant_activity(uuid, uuid, text, text, text, text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_tenant_activity(uuid, uuid, text, text, text, text, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_tenant_activity(uuid, uuid, text, text, text, text, text, text, jsonb) TO service_role;

-- Allow super admins to write audit events for the workspace they are operating in
DROP POLICY IF EXISTS "Super admins insert workspace activity" ON public.user_activity_log;
CREATE POLICY "Super admins insert workspace activity"
  ON public.user_activity_log
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Generic tenant audit trigger for core workspace tables
CREATE OR REPLACE FUNCTION public.audit_core_table_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant_id uuid;
  _actor uuid;
  _actor_email text;
  _actor_name text;
  _row_id text;
  _action text;
  _entity text;
  _description text;
  _name text;
  _metadata jsonb;
BEGIN
  _tenant_id := COALESCE((to_jsonb(NEW)->>'tenant_id')::uuid, (to_jsonb(OLD)->>'tenant_id')::uuid);
  IF _tenant_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  _actor := auth.uid();
  IF _actor IS NOT NULL THEN
    SELECT p.display_name, u.email
      INTO _actor_name, _actor_email
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.user_id
    WHERE p.user_id = _actor
    LIMIT 1;
  END IF;

  _row_id := COALESCE(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id');
  _entity := TG_TABLE_NAME;
  _action := lower(TG_OP);
  _name := COALESCE(
    to_jsonb(NEW)->>'name', to_jsonb(OLD)->>'name',
    to_jsonb(NEW)->>'business_name', to_jsonb(OLD)->>'business_name',
    to_jsonb(NEW)->>'customer_name', to_jsonb(OLD)->>'customer_name',
    to_jsonb(NEW)->>'supplier_name', to_jsonb(OLD)->>'supplier_name',
    to_jsonb(NEW)->>'invoice_number', to_jsonb(OLD)->>'invoice_number',
    to_jsonb(NEW)->>'quote_number', to_jsonb(OLD)->>'quote_number',
    to_jsonb(NEW)->>'delivery_number', to_jsonb(OLD)->>'delivery_number',
    _row_id
  );

  IF TG_TABLE_NAME = 'transactions' THEN
    IF TG_OP = 'INSERT' THEN
      _action := 'sale_created';
      _description := 'Sale created for ' || COALESCE(to_jsonb(NEW)->>'customer_name', 'Walk-in') || ' (' || COALESCE(to_jsonb(NEW)->>'payment_method', 'unknown') || ')';
    ELSIF TG_OP = 'UPDATE' AND COALESCE(to_jsonb(OLD)->>'status', '') IS DISTINCT FROM COALESCE(to_jsonb(NEW)->>'status', '') THEN
      IF to_jsonb(NEW)->>'status' = 'completed' AND to_jsonb(NEW)->>'payment_method' = 'mpesa' THEN
        _action := 'mpesa_stk_confirmed';
        _description := 'M-Pesa STK payment confirmed: ' || COALESCE(to_jsonb(NEW)->>'mpesa_ref', _row_id);
      ELSIF to_jsonb(NEW)->>'status' = 'failed' AND to_jsonb(NEW)->>'payment_method' = 'mpesa' THEN
        _action := 'mpesa_stk_failed';
        _description := 'M-Pesa STK payment failed: ' || COALESCE(to_jsonb(NEW)->>'mpesa_ref', _row_id);
      ELSIF to_jsonb(NEW)->>'status' = 'cancelled' AND to_jsonb(NEW)->>'payment_method' = 'mpesa' THEN
        _action := 'payment_reversed';
        _description := 'M-Pesa STK push cancelled/reversed: ' || COALESCE(to_jsonb(NEW)->>'mpesa_ref', _row_id);
      ELSE
        _action := 'payment_status_changed';
        _description := 'Payment status changed from ' || COALESCE(to_jsonb(OLD)->>'status', 'unknown') || ' to ' || COALESCE(to_jsonb(NEW)->>'status', 'unknown');
      END IF;
    ELSE
      _description := initcap(_action) || ' transactions record ' || COALESCE(_name, _row_id);
    END IF;
  ELSE
    _description := initcap(_action) || ' ' || replace(_entity, '_', ' ') || COALESCE(' "' || _name || '"', '');
  END IF;

  _metadata := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'operation', TG_OP,
    'old_status', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD)->>'status' ELSE NULL END,
    'new_status', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW)->>'status' ELSE NULL END,
    'transaction_ref', COALESCE(to_jsonb(NEW)->>'mpesa_ref', to_jsonb(OLD)->>'mpesa_ref', _row_id),
    'total', COALESCE(to_jsonb(NEW)->>'total', to_jsonb(OLD)->>'total')
  );

  PERFORM public.record_tenant_activity(
    _tenant_id,
    _actor,
    _actor_email,
    _actor_name,
    _action,
    _entity,
    _row_id,
    _description,
    _metadata
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_core_table_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_core_table_changes() FROM anon;
REVOKE ALL ON FUNCTION public.audit_core_table_changes() FROM authenticated;

DO $$
DECLARE
  _tbl text;
BEGIN
  FOREACH _tbl IN ARRAY ARRAY[
    'business_settings','products','product_batches','product_stocks','customers','transactions',
    'purchases','purchase_items','expenses','bills','invoices','quotes','locations','profiles',
    'cash_register','stock_adjustments','packing_lists','delivery_notes','suppliers'
  ] LOOP
    IF to_regclass('public.' || _tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_%I_changes ON public.%I', _tbl, _tbl);
      EXECUTE format('CREATE TRIGGER audit_%I_changes AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_core_table_changes()', _tbl, _tbl);
    END IF;
  END LOOP;
END $$;