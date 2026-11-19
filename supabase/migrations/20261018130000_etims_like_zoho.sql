-- KRA eTIMS details as Zoho Books keeps them.
-- Items: product type (1 raw material, 2 finished product, 3 service), packaging unit,
-- quantity unit and country of origin (KRA code lists).
alter table public.products add column if not exists etims_item_type text check (etims_item_type in ('1', '2', '3'));
alter table public.products add column if not exists etims_pkg_unit text;
alter table public.products add column if not exists etims_qty_unit text;
alter table public.products add column if not exists etims_origin text;
-- Customers and vendors: VAT treatment (registered for VAT with a PIN, or not).
alter table public.customers add column if not exists tax_treatment text check (tax_treatment in ('vat_registered', 'vat_not_registered', 'non_kenya'));
alter table public.suppliers add column if not exists tax_treatment text check (tax_treatment in ('vat_registered', 'vat_not_registered', 'non_kenya'));
-- Invoices keep the customer's PIN and treatment as they were when issued (KRA receipt).
alter table public.invoices add column if not exists customer_pin text;
alter table public.invoices add column if not exists tax_treatment text;
alter table public.credit_notes add column if not exists customer_pin text;
-- Stock reported to KRA after a sale or return.
alter table public.invoices add column if not exists etims_stock_status text;
alter table public.credit_notes add column if not exists etims_stock_status text;
-- Integration token requests: the company asks JMSURF TAX, JMSURF issues the token for KRA's portal.
create table if not exists public.etims_token_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  kra_pin text not null,
  branch_id text not null default '00',
  device_serial text not null,
  contact_phone text,
  contact_email text,
  status text not null default 'requested' check (status in ('requested', 'issued', 'rejected')),
  token text,
  note text,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  issued_at timestamptz
);
alter table public.etims_token_requests enable row level security;
drop policy if exists etims_token_requests_tenant on public.etims_token_requests;
create policy etims_token_requests_tenant on public.etims_token_requests for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists etims_token_requests_insert on public.etims_token_requests;
create policy etims_token_requests_insert on public.etims_token_requests for insert to authenticated with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));
drop policy if exists etims_token_requests_platform on public.etims_token_requests;
create policy etims_token_requests_platform on public.etims_token_requests for update to authenticated using (public.has_role(auth.uid(), 'super_admin')) with check (public.has_role(auth.uid(), 'super_admin'));
grant select, insert, update on public.etims_token_requests to authenticated;

-- When JMSURF issues (or closes) a token request, the company's admins are told.
create or replace function public.etims_token_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('issued', 'rejected') then
    insert into public.shop_notifications (tenant_id, kind, title, body, link, role)
    values (new.tenant_id, 'etims',
      case when new.status = 'issued' then 'Your KRA eTIMS integration token is ready' else 'KRA eTIMS token request needs attention' end,
      case when new.status = 'issued' then 'Open System → KRA eTIMS, copy the token and enter it on KRA''s portal with the OSCU request.' else coalesce(new.note, 'Contact JMSURF support.') end,
      '/settings?tab=etims', 'admin');
  end if;
  return new;
end $$;
drop trigger if exists etims_token_notify_trg on public.etims_token_requests;
create trigger etims_token_notify_trg after update on public.etims_token_requests for each row execute function public.etims_token_notify();
