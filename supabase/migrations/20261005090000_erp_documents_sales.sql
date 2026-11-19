-- JMSURF DASH: documents and the sales core.
--  * document_templates: print settings per document kind (Settings → Documents)
--  * company details used on documents (website, postal, VAT, bank, default terms)
--  * doc_sequences + next_doc_number(): QT-000001, INV-000001, PR-000001 …
--  * quotes / invoices gain fields (reference, dates, salesperson, terms …)
--  * payments_received + payment_allocations keep invoices.amount_paid / status
-- Apply as supabase_admin (business_settings_safe is owned by it).

-- ---------------------------------------------------------------- document templates
create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  template text not null default 'standard',
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind)
);
alter table public.document_templates enable row level security;
drop policy if exists document_templates_read on public.document_templates;
create policy document_templates_read on public.document_templates for select to authenticated
  using (tenant_id = public.current_user_tenant_id() or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists document_templates_manage on public.document_templates;
create policy document_templates_manage on public.document_templates for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));
grant select, insert, update, delete on public.document_templates to authenticated;

-- ---------------------------------------------------------------- company details on documents
alter table public.business_settings
  add column if not exists business_website text,
  add column if not exists postal_address text,
  add column if not exists vat_number text,
  add column if not exists bank_details text,
  add column if not exists quote_terms text,
  add column if not exists quote_notes text,
  add column if not exists invoice_terms text,
  add column if not exists invoice_notes text,
  add column if not exists payment_terms_days integer not null default 0,
  add column if not exists erp_settings jsonb not null default '{}'::jsonb;

create or replace view public.business_settings_safe with (security_barrier = true, security_invoker = false) as
 SELECT bs.id, bs.tenant_id, bs.business_name, bs.business_email, bs.business_phone, bs.business_address, bs.tax_pin,
    bs.receipt_header, bs.receipt_footer, bs.default_vat_rate, bs.daily_sales_target, bs.payment_provider,
    bs.mpesa_environment, bs.mpesa_shortcode, bs.mpesa_till_number, bs.mpesa_transaction_type, bs.mpesa_account_reference,
    bs.barcode_format, bs.barcode_label_width, bs.barcode_label_height, bs.barcode_show_name, bs.barcode_show_price,
    CASE WHEN m.manager THEN bs.smtp_host ELSE NULL::text END AS smtp_host,
    CASE WHEN m.manager THEN bs.smtp_port ELSE NULL::text END AS smtp_port,
    CASE WHEN m.manager THEN bs.smtp_username ELSE NULL::text END AS smtp_username,
    CASE WHEN m.manager THEN bs.smtp_from_email ELSE NULL::text END AS smtp_from_email,
    CASE WHEN m.manager THEN bs.smtp_from_name ELSE NULL::text END AS smtp_from_name,
    CASE WHEN m.manager THEN bs.smtp_encryption ELSE NULL::text END AS smtp_encryption,
    bs.created_at, bs.updated_at, bs.updated_by,
    CASE bs.payment_provider
        WHEN 'jmsurf'::text THEN (EXISTS (SELECT 1 FROM sendmoney_tenants st WHERE st.tenant_id = bs.tenant_id))
        WHEN 'mpesa'::text THEN m.payhero_channel OR COALESCE(NULLIF(bs.mpesa_till_number, ''::text), bs.mpesa_shortcode, ''::text) ~ '^[0-9]{5,7}$'::text
        WHEN 'payhero'::text THEN m.payhero_channel OR COALESCE(NULLIF(bs.mpesa_till_number, ''::text), bs.mpesa_shortcode, ''::text) ~ '^[0-9]{5,7}$'::text
        WHEN 'bank'::text THEN m.payhero_channel
        WHEN 'daraja'::text THEN COALESCE(bs.mpesa_consumer_key, ''::text) <> ''::text AND COALESCE(bs.mpesa_consumer_secret, ''::text) <> ''::text AND COALESCE(bs.mpesa_passkey, ''::text) <> ''::text AND COALESCE(bs.mpesa_shortcode, ''::text) <> ''::text
        WHEN 'paystack'::text THEN COALESCE(bs.paystack_secret_key, ''::text) <> ''::text
        ELSE false
    END AS mpesa_ready,
    bs.currency, bs.use_platform_smtp, bs.use_platform_mpesa, bs.stk_label_mode, bs.stk_label_override,
    bs.paystack_public_key, bs.idle_timeout_minutes, bs.session_warning_seconds, bs.daily_logout_time,
    COALESCE(bs.mpesa_consumer_key, ''::text) <> ''::text AS has_mpesa_consumer_key,
    COALESCE(bs.mpesa_consumer_secret, ''::text) <> ''::text AS has_mpesa_consumer_secret,
    COALESCE(bs.mpesa_passkey, ''::text) <> ''::text AS has_mpesa_passkey,
    COALESCE(bs.paystack_secret_key, ''::text) <> ''::text AS has_paystack_secret_key,
    COALESCE(bs.smtp_password, ''::text) <> ''::text AS has_smtp_password,
    bs.country, bs.receipt_terms, bs.receipt_template,
    -- 2026-10-05: company details and defaults for documents
    bs.business_website, bs.postal_address, bs.vat_number, bs.bank_details,
    bs.quote_terms, bs.quote_notes, bs.invoice_terms, bs.invoice_notes, bs.payment_terms_days, bs.erp_settings
   FROM business_settings bs
     CROSS JOIN LATERAL ( SELECT has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role) AS manager,
            (EXISTS ( SELECT 1 FROM tenant_payout_channels c
                  WHERE c.tenant_id = bs.tenant_id AND c.is_active AND c.payhero_channel_id IS NOT NULL)) AS payhero_channel) m
  WHERE auth.uid() IS NOT NULL AND (bs.tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

-- ---------------------------------------------------------------- document numbering
create table if not exists public.doc_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  prefix text not null,
  next_value bigint not null default 1,
  pad integer not null default 6,
  primary key (tenant_id, kind)
);
alter table public.doc_sequences enable row level security;
drop policy if exists doc_sequences_read on public.doc_sequences;
create policy doc_sequences_read on public.doc_sequences for select to authenticated
  using (tenant_id = public.current_user_tenant_id());
drop policy if exists doc_sequences_manage on public.doc_sequences;
create policy doc_sequences_manage on public.doc_sequences for update to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id());
grant select, update on public.doc_sequences to authenticated;

/** Default prefix for a document kind. */
create or replace function public.doc_prefix_default(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'quote' then 'QT-' when 'invoice' then 'INV-' when 'payment' then 'PR-' when 'receipt' then 'SR-'
    when 'credit_note' then 'CN-' when 'po' then 'PO-' when 'bill' then 'BILL-' when 'requisition' then 'REQ-'
    when 'delivery_note' then 'DN-' when 'lead' then 'LD-' else upper(left(p_kind, 3)) || '-' end
$$;

/** Next number for a document kind in the caller's shop, e.g. INV-000042. */
create or replace function public.next_doc_number(p_kind text, p_tenant uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  t uuid := coalesce(p_tenant, public.current_user_tenant_id());
  r public.doc_sequences;
begin
  if t is null then raise exception 'No shop for this account'; end if;
  if p_tenant is not null and auth.uid() is not null and p_tenant <> public.current_user_tenant_id()
     and not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Not allowed';
  end if;
  insert into public.doc_sequences (tenant_id, kind, prefix) values (t, p_kind, public.doc_prefix_default(p_kind))
    on conflict (tenant_id, kind) do nothing;
  update public.doc_sequences set next_value = next_value + 1
    where tenant_id = t and kind = p_kind returning * into r;
  return r.prefix || lpad((r.next_value - 1)::text, r.pad, '0');
end $$;
revoke all on function public.next_doc_number(text, uuid) from public, anon;
grant execute on function public.next_doc_number(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- quotes / invoices: fields
alter table public.quotes
  add column if not exists reference text,
  add column if not exists issue_date date not null default current_date,
  add column if not exists subject text,
  add column if not exists salesperson_id uuid,
  add column if not exists salesperson_name text,
  add column if not exists customer_phone text,
  add column if not exists customer_email text,
  add column if not exists terms text,
  add column if not exists customer_notes text,
  add column if not exists adjustment numeric not null default 0,
  add column if not exists shipping numeric not null default 0,
  add column if not exists invoice_id uuid,
  add column if not exists sent_at timestamptz,
  add column if not exists accepted_at timestamptz;

alter table public.invoices
  add column if not exists reference text,
  add column if not exists issue_date date not null default current_date,
  add column if not exists subject text,
  add column if not exists salesperson_id uuid,
  add column if not exists salesperson_name text,
  add column if not exists customer_phone text,
  add column if not exists terms text,
  add column if not exists customer_notes text,
  add column if not exists payment_terms text,
  add column if not exists adjustment numeric not null default 0,
  add column if not exists shipping numeric not null default 0,
  add column if not exists amount_paid numeric not null default 0,
  add column if not exists quote_id uuid,
  add column if not exists transaction_id uuid,
  add column if not exists source text not null default 'manual';

create index if not exists invoices_tenant_status_idx on public.invoices (tenant_id, status);
create index if not exists invoices_customer_idx on public.invoices (customer_id);
create index if not exists invoices_due_idx on public.invoices (tenant_id, due_date);

-- ---------------------------------------------------------------- payments received
create table if not exists public.payments_received (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_number text,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  payment_date date not null default current_date,
  amount numeric not null check (amount > 0),
  method text not null default 'cash',
  reference text,
  notes text,
  received_by uuid,
  received_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists payments_received_tenant_idx on public.payments_received (tenant_id, payment_date desc);
create index if not exists payments_received_customer_idx on public.payments_received (customer_id);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_id uuid not null references public.payments_received(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists payment_allocations_invoice_idx on public.payment_allocations (invoice_id);
create index if not exists payment_allocations_payment_idx on public.payment_allocations (payment_id);

alter table public.payments_received enable row level security;
alter table public.payment_allocations enable row level security;
do $$ declare t text; begin
  foreach t in array array['payments_received', 'payment_allocations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.has_role(auth.uid(), ''super_admin''))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_manage', t);
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), ''admin'') or public.has_role(auth.uid(), ''manager'') or public.has_role(auth.uid(), ''cashier''))) with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), ''admin'') or public.has_role(auth.uid(), ''manager'') or public.has_role(auth.uid(), ''cashier'')))', t || '_manage', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

/** Recompute an invoice's amount paid and payment status from its allocations. */
create or replace function public.invoice_refresh_paid(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare paid numeric; inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found then return; end if;
  select coalesce(sum(amount), 0) into paid from public.payment_allocations where invoice_id = p_invoice;
  update public.invoices set
    amount_paid = paid,
    paid_at = case when paid >= inv.total - 0.005 and inv.total > 0 then coalesce(inv.paid_at, now()) else null end,
    status = case
      when inv.status in ('draft', 'void') then inv.status
      when paid >= inv.total - 0.005 and inv.total > 0 then 'paid'
      when paid > 0 then 'partially_paid'
      when inv.status in ('paid', 'partially_paid') then 'sent'
      else inv.status end,
    updated_at = now()
  where id = p_invoice;
end $$;

create or replace function public.payment_allocations_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public.invoice_refresh_paid(new.invoice_id); end if;
  if tg_op in ('DELETE', 'UPDATE') then perform public.invoice_refresh_paid(old.invoice_id); end if;
  return null;
end $$;
drop trigger if exists payment_allocations_sync on public.payment_allocations;
create trigger payment_allocations_sync after insert or update or delete on public.payment_allocations
  for each row execute function public.payment_allocations_sync();

/**
 * Record a customer payment and apply it to invoices (oldest first unless a
 * list is given). Returns the payment row id. Any amount left over stays on
 * the payment as unapplied credit.
 */
create or replace function public.record_customer_payment(
  p_customer uuid, p_amount numeric, p_method text, p_reference text default null, p_notes text default null,
  p_date date default current_date, p_invoices uuid[] default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_user_tenant_id();
  pay_id uuid; left_amt numeric := p_amount; inv record; take numeric; cname text; who text;
begin
  if t is null then raise exception 'No shop for this account'; end if;
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'cashier')) then
    raise exception 'Not allowed';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  select name into cname from public.customers where id = p_customer and tenant_id = t;
  select display_name into who from public.profiles where user_id = auth.uid();
  insert into public.payments_received (tenant_id, payment_number, customer_id, customer_name, payment_date, amount, method, reference, notes, received_by, received_by_name)
    values (t, public.next_doc_number('payment', t), p_customer, cname, coalesce(p_date, current_date), p_amount, coalesce(nullif(p_method, ''), 'cash'), p_reference, p_notes, auth.uid(), who)
    returning id into pay_id;
  for inv in
    select id, total - amount_paid as due from public.invoices
     where tenant_id = t and customer_id = p_customer and status not in ('draft', 'void', 'paid')
       and total - amount_paid > 0.005 and (p_invoices is null or id = any(p_invoices))
     order by coalesce(due_date, issue_date), created_at
  loop
    exit when left_amt <= 0.005;
    take := least(left_amt, inv.due);
    insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount) values (t, pay_id, inv.id, take);
    left_amt := left_amt - take;
  end loop;
  return pay_id;
end $$;
revoke all on function public.record_customer_payment(uuid, numeric, text, text, text, date, uuid[]) from public, anon;
grant execute on function public.record_customer_payment(uuid, numeric, text, text, text, date, uuid[]) to authenticated;

alter publication supabase_realtime add table public.payments_received;
