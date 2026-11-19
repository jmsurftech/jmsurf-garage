-- Internal helpers take a company id and write the books: never callable from
-- the app's API (anon/authenticated). Triggers and SECURITY DEFINER callers still use them.
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'acc_seed', 'acc_key', 'acc_expense_account', 'acc_method_account', 'acc_lock_date', 'acc_post', 'acc_items_cost',
             'acc_post_invoice', 'acc_post_payment_received', 'acc_post_credit_note', 'acc_post_bill', 'acc_post_supplier_payment',
             'acc_post_vendor_credit', 'acc_post_expense', 'acc_post_sale', 'acc_document_trigger', 'acc_seed_new_tenant',
             'mrp_stock_move', 'app_records_before', 'sync_tenant_member_from_profile', 'sync_tenant_member_from_role')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
-- tenant_module_active is used by policies; the app only needs it for its own company.
revoke all on function public.tenant_module_active(uuid, text) from public, anon;
