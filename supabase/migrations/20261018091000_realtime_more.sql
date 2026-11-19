-- Live updates for the newer modules: every open screen refreshes when these change.
do $$
declare t text;
begin
  foreach t in array array['crm_deals','hr_employees','sales_orders','vendor_credits','chart_of_accounts','contracts','contract_events','contract_issues','signature_requests','user_signatures','supplier_payments','bank_transactions'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
