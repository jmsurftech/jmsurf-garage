-- Security: functions that run with owner rights and have no caller check of
-- their own must not be callable from the public API.
--  * server-only (called by the app server with the service key): service_role only
--  * called by signed-in staff in the app: no anonymous access
--  * internal helpers (called by other functions / triggers): nobody via the API
do $$
declare f text; r record;
begin
  for r in select p.oid::regprocedure::text sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'consume_sms_units', 'refund_sms_units', 'customer_find_or_create_for', 'phone_taken', 'settle_invoice_mpesa',
             'settle_payhero_payment', 'settle_sendmoney_payment', 'ticket_customer_open', 'ticket_customer_reply', 'user_has_mfa',
             'water_customer_cancel', 'water_place_order',
             '_req_refresh_total', 'apply_sale_stock', 'commission_pct', 'credit_note_refresh', 'record_tenant_activity', 'rls_auto_enable',
             'ticket_next_no', 'water_order_log', 'water_staff_name', 'water_sync_sizes', 'water_tank_move')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
  for r in select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('hr_can', 'hr_next_employee_no', 'invoice_refresh_paid', 'pay_purchase', 'water_set_price')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
