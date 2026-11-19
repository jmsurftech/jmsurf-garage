-- Security hardening (2026-10-06)
--  * Functions that settle M-Pesa payments or move SMS units are for the app
--    server (service role) only; signed-in users and visitors cannot call them.
--  * Visitors (anon) cannot confirm e-mail addresses.
--  * Visitors cannot write to tables directly (the server does that); only the
--    two public forms (contact enquiries and leads) keep their insert.
--  * suppressed_emails is readable by the service role only.

revoke execute on function public.settle_sendmoney_payment(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.consume_sms_units(uuid, integer) from public, anon, authenticated;
revoke execute on function public.refund_sms_units(uuid, integer) from public, anon, authenticated;
revoke execute on function public._purchase_bill(uuid) from public, anon, authenticated;
do $$ begin
  execute 'revoke execute on function public.settle_payhero_payment from public, anon, authenticated';
exception when others then
  perform 1;
end $$;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('settle_payhero_payment', 'confirm_user_email', 'rls_auto_enable', 'settle_invoice_mpesa') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
  -- keep signed-in admins able to verify their own staff (checked inside the function)
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'confirm_user_email' loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('settle_payhero_payment', 'settle_invoice_mpesa', 'rls_auto_enable') loop
    execute format('revoke execute on function %s from authenticated', f.sig);
  end loop;
end $$;

-- Visitors never write directly.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'v', 'p') and c.relname not in ('contact_inquiries', 'leads') loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon', t.relname);
  end loop;
end $$;

-- Secrets and sessions are never readable by visitors.
revoke all on public.integration_secrets, public.customer_accounts, public.customer_sessions, public.tenant_backups, public.invoice_mpesa_requests from anon;

drop policy if exists "Service role can read suppressed emails" on public.suppressed_emails;
create policy "Service role can read suppressed emails" on public.suppressed_emails for select using (auth.role() = 'service_role');
drop policy if exists "Service role can insert suppressed emails" on public.suppressed_emails;
create policy "Service role can insert suppressed emails" on public.suppressed_emails for insert with check (auth.role() = 'service_role');
