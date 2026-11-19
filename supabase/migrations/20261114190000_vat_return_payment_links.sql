-- KRA VAT return (VAT3) helpers and invoice payment links. Re-runnable.
--
-- 1. VAT return. The return itself is worked out in the app from what is already stored
--    (invoices / credit notes / POS sales for output VAT; bills, vendor credits and expenses
--    for input VAT; payments_received.withholding_vat for VAT withheld by customers).
--    New here: wht_vat_certificates, one row per customer payment that had withholding VAT,
--    holding the certificate number KRA issued, so the accountant can see which certificates
--    have come in. Read and written by people allowed to see tax reports (vat_reports_can():
--    owners; a company role with "reports.taxes.view"; otherwise the older Reports switch).
--
-- 2. Invoice payment links. invoice_pay_links holds one unguessable token (64 hex characters,
--    two random UUIDs) per invoice; staff get or make it with invoice_pay_link() and switch it
--    off with invoice_pay_link_revoke() (a new one can then be made). The public page /pay/<token>
--    talks only to the server (/api/pub/pay…, paylinks.js), which looks the token up with the
--    service key and returns that one invoice's summary. M-Pesa prompts reuse
--    invoice_mpesa_requests + settle_invoice_mpesa(). Card payments (the company's own Paystack)
--    are kept in invoice_card_payments and settled by settle_invoice_card(), which records the
--    payment exactly as settle_invoice_mpesa() does (payments_received + payment_allocations;
--    the existing triggers update the invoice and post to the books).
--    Anonymous users are granted nothing here.

-- ── permission helper ───────────────────────────────────────────────────────
create or replace function public.vat_reports_can()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin') or coalesce((
    select case when r.id is null then public.has_shop_permission('reports')
                else coalesce((r.permissions ->> 'reports.taxes.view')::boolean, false) end
      from public.profiles p left join public.company_roles r on r.id = p.company_role_id
     where p.user_id = auth.uid() limit 1), false)
$$;
revoke all on function public.vat_reports_can() from public, anon;
grant execute on function public.vat_reports_can() to authenticated, service_role;

-- ── 1. withholding VAT certificates ─────────────────────────────────────────
create table if not exists public.wht_vat_certificates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_id uuid not null references public.payments_received(id) on delete cascade,
  certificate_number text,
  certificate_date date,
  notes text,
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id)
);
create index if not exists wht_vat_certificates_tenant_idx on public.wht_vat_certificates (tenant_id);

alter table public.wht_vat_certificates enable row level security;
drop policy if exists wht_vat_certificates_rw on public.wht_vat_certificates;
create policy wht_vat_certificates_rw on public.wht_vat_certificates for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.vat_reports_can())
  with check (tenant_id = public.current_user_tenant_id() and public.vat_reports_can()
              and exists (select 1 from public.payments_received p where p.id = payment_id and p.tenant_id = wht_vat_certificates.tenant_id));
revoke all on public.wht_vat_certificates from anon;
grant select, insert, update, delete on public.wht_vat_certificates to authenticated;

-- ── 2. invoice payment links ────────────────────────────────────────────────
create table if not exists public.invoice_pay_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  last_opened_at timestamptz,
  opens integer not null default 0,
  constraint invoice_pay_links_token_format check (token ~ '^[0-9a-f]{64}$')
);
create unique index if not exists invoice_pay_links_one_active on public.invoice_pay_links (invoice_id) where revoked_at is null;
create index if not exists invoice_pay_links_tenant_idx on public.invoice_pay_links (tenant_id, created_at desc);

alter table public.invoice_pay_links enable row level security;
drop policy if exists invoice_pay_links_read on public.invoice_pay_links;
create policy invoice_pay_links_read on public.invoice_pay_links for select to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.has_shop_permission('invoices'));
revoke all on public.invoice_pay_links from anon, authenticated;
grant select on public.invoice_pay_links to authenticated;

/** The invoice's payment link token: the live one, or a new one. Not for void invoices. */
create or replace function public.invoice_pay_link(p_invoice uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); inv public.invoices; tok text;
begin
  if t is null then raise exception 'Sign in first'; end if;
  if not public.has_shop_permission('invoices') then raise exception 'Not allowed'; end if;
  select * into inv from public.invoices where id = p_invoice and tenant_id = t;
  if not found then raise exception 'Invoice not found'; end if;
  if inv.status = 'void' then raise exception 'A void invoice cannot be paid'; end if;
  select token into tok from public.invoice_pay_links where invoice_id = inv.id and revoked_at is null;
  if tok is not null then return tok; end if;
  insert into public.invoice_pay_links (tenant_id, invoice_id) values (t, inv.id)
    on conflict (invoice_id) where revoked_at is null do nothing
    returning token into tok;
  if tok is null then select token into tok from public.invoice_pay_links where invoice_id = inv.id and revoked_at is null; end if;
  return tok;
end $$;
revoke all on function public.invoice_pay_link(uuid) from public, anon;
grant execute on function public.invoice_pay_link(uuid) to authenticated, service_role;

/** Switches the invoice's payment link off. The next "Copy payment link" makes a new one. */
create or replace function public.invoice_pay_link_revoke(p_invoice uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); n integer;
begin
  if t is null then raise exception 'Sign in first'; end if;
  if not public.has_shop_permission('invoices') then raise exception 'Not allowed'; end if;
  update public.invoice_pay_links set revoked_at = now(), revoked_by = auth.uid()
   where invoice_id = p_invoice and tenant_id = t and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.invoice_pay_link_revoke(uuid) from public, anon;
grant execute on function public.invoice_pay_link_revoke(uuid) to authenticated, service_role;

-- Card payments started from a payment link (the company's own Paystack account).
create table if not exists public.invoice_card_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  link_id uuid references public.invoice_pay_links(id) on delete set null,
  gateway text not null default 'paystack',
  amount numeric not null check (amount >= 1),
  currency text not null default 'KES',
  email text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  provider_reference text,
  provider_status jsonb,
  payment_id uuid,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  settled_at timestamptz
);
create index if not exists invoice_card_payments_pending_idx on public.invoice_card_payments (status, created_at) where status = 'pending';
create index if not exists invoice_card_payments_invoice_idx on public.invoice_card_payments (invoice_id);
alter table public.invoice_card_payments enable row level security;
drop policy if exists invoice_card_payments_read on public.invoice_card_payments;
create policy invoice_card_payments_read on public.invoice_card_payments for select to authenticated
  using (tenant_id = public.current_user_tenant_id());
revoke all on public.invoice_card_payments from anon, authenticated;
grant select on public.invoice_card_payments to authenticated;

/** Server-side: a confirmed card payment becomes a payment applied to its invoice (once), as settle_invoice_mpesa does. */
create or replace function public.settle_invoice_card(p_request uuid, p_status text, p_reference text, p_provider jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare r public.invoice_card_payments; i public.invoices; num text; pid uuid; amt numeric;
begin
  select * into r from public.invoice_card_payments where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status = 'completed' then return 'completed'; end if;
  if p_status <> 'completed' then
    update public.invoice_card_payments set status = p_status, provider_status = p_provider, checked_at = now() where id = r.id;
    return p_status;
  end if;
  select * into i from public.invoices where id = r.invoice_id for update;
  amt := least(r.amount, greatest(0, i.total - i.amount_paid));
  num := public.next_doc_number('payment', r.tenant_id);
  insert into public.payments_received (tenant_id, payment_number, customer_id, customer_name, payment_date, amount, method, reference, notes, received_by_name)
  values (r.tenant_id, num, i.customer_id, i.customer_name, current_date, r.amount, 'card', p_reference, 'Card payment for ' || i.invoice_number || ' (payment link)', 'Card (Paystack)')
  returning id into pid;
  if amt > 0 then insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount) values (r.tenant_id, pid, i.id, amt); end if;
  update public.invoice_card_payments set status = 'completed', provider_reference = p_reference, provider_status = p_provider, payment_id = pid, settled_at = now(), checked_at = now() where id = r.id;
  insert into public.shop_notifications (tenant_id, kind, title, body, link, role, entity_type, entity_id)
  values (r.tenant_id, 'payment', 'Card payment received for ' || i.invoice_number, coalesce(i.customer_name, '') || ' paid ' || r.currency || ' ' || r.amount || ' · ' || coalesce(p_reference, ''), '/sales/invoices/' || i.id, 'admin', 'invoice', i.id);
  return 'completed';
end $$;
revoke all on function public.settle_invoice_card(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.settle_invoice_card(uuid, text, text, jsonb) to service_role;
