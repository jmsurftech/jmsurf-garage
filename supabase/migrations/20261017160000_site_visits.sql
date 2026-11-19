-- Website visits (CRM → Visits): page views on a company's own website, by an
-- anonymous visitor id, with where they came from. A visitor who sends the contact
-- form is linked to the lead it creates.
create table if not exists public.site_visits (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visitor_id text not null,
  path text not null,
  title text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  device text,
  lead_id uuid references public.crm_leads(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists site_visits_tenant_time on public.site_visits (tenant_id, created_at desc);
create index if not exists site_visits_tenant_visitor on public.site_visits (tenant_id, visitor_id);
alter table public.site_visits enable row level security;
drop policy if exists site_visits_read on public.site_visits;
create policy site_visits_read on public.site_visits for select to authenticated using (tenant_id = public.current_user_tenant_id());
drop policy if exists site_visits_delete on public.site_visits;
create policy site_visits_delete on public.site_visits for delete to authenticated using (tenant_id = public.current_user_tenant_id() and public.can_manage_shop());
grant select, delete on public.site_visits to authenticated;
