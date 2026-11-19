-- Super admin CRM: platform leads (pipeline), their activity, campaigns to
-- leads and companies, and the owner's alerts (new sign-up, payment, lead,
-- website enquiry) sent by the server on the channels chosen in
-- Admin → Notifications. Only platform owners can read or change any of it.

create table if not exists public.platform_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  phone text,
  country text default 'KE',
  source text not null default 'manual',            -- signup, website, demo, referral, event, manual
  stage text not null default 'new' check (stage in ('new', 'contacted', 'demo', 'trial', 'proposal', 'won', 'lost')),
  value numeric(14,2) default 0,
  tags text[] not null default '{}',
  notes text,
  next_follow_up date,
  tenant_id uuid references public.tenants(id) on delete set null,
  owner_id uuid,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists platform_leads_tenant_uq on public.platform_leads (tenant_id) where tenant_id is not null;
create index if not exists platform_leads_stage_idx on public.platform_leads (stage, created_at desc);

create table if not exists public.platform_lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.platform_leads(id) on delete cascade,
  kind text not null default 'note',                 -- note, call, email, sms, meeting, stage
  body text,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  audience jsonb not null default '{"type":"leads","stages":[]}'::jsonb,
  subject text,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  sent_count int not null default 0,
  failed_count int not null default 0,
  sent_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.platform_alert_queue (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  title text not null,
  body text,
  link text,
  status text not null default 'new',
  detail text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

do $$ declare t text; begin
  foreach t in array array['platform_leads', 'platform_lead_activities', 'platform_campaigns', 'platform_alert_queue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.has_role(auth.uid(), %L)) with check (public.has_role(auth.uid(), %L))', t || '_owner', t, 'super_admin', 'super_admin');
  end loop;
end $$;

-- New companies become leads (trial) and alert the owner.
create or replace function public.platform_lead_from_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.platform_leads (name, company, email, phone, source, stage, tenant_id, notes)
  values (coalesce(NEW.contact_name, NEW.business_name), NEW.business_name, coalesce(NEW.contact_email, NEW.business_email), coalesce(NEW.contact_phone, NEW.business_phone),
          'signup', 'trial', NEW.id, nullif(concat_ws(' · ', NEW.industry, 'https://' || NEW.slug || '.jmsurfdash.co.ke'), ''))
  on conflict do nothing;
  insert into public.platform_alert_queue (event, title, body, link)
  values ('signup', 'New sign-up: ' || NEW.business_name, concat_ws(' · ', NEW.contact_name, NEW.contact_email, NEW.contact_phone, NEW.industry), '/admin/customers');
  return NEW;
exception when others then
  raise warning 'platform lead for tenant %: %', NEW.id, sqlerrm;
  return NEW;
end $$;
drop trigger if exists platform_lead_from_tenant on public.tenants;
create trigger platform_lead_from_tenant after insert on public.tenants for each row execute function public.platform_lead_from_tenant();

-- Website enquiries become leads too.
create or replace function public.platform_lead_from_inquiry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.platform_leads (name, email, source, stage, notes)
  values (NEW.name, NEW.email, 'website', 'new', concat_ws(': ', NEW.subject, NEW.message));
  insert into public.platform_alert_queue (event, title, body, link)
  values ('inquiry', 'Website enquiry: ' || coalesce(NEW.subject, NEW.name), concat_ws(' · ', NEW.name, NEW.email, left(NEW.message, 300)), '/admin/leads');
  return NEW;
exception when others then
  return NEW;
end $$;
drop trigger if exists platform_lead_from_inquiry on public.contact_inquiries;
create trigger platform_lead_from_inquiry after insert on public.contact_inquiries for each row execute function public.platform_lead_from_inquiry();

-- Successful subscription payments alert the owner.
create or replace function public.platform_alert_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if NEW.status not in ('success', 'completed', 'paid') or (TG_OP = 'UPDATE' and OLD.status is not distinct from NEW.status) then return NEW; end if;
  select business_name into nm from public.tenants where id = NEW.tenant_id;
  insert into public.platform_alert_queue (event, title, body, link)
  values ('payment', 'Payment received: ' || coalesce(nm, 'a company'), 'KES ' || to_char(coalesce(NEW.amount, 0), 'FM999,999,990.00') || coalesce(' · ' || NEW.gateway, ''), '/admin/payments');
  return NEW;
exception when others then
  return NEW;
end $$;
drop trigger if exists platform_alert_payment on public.subscription_payments;
create trigger platform_alert_payment after insert or update of status on public.subscription_payments for each row execute function public.platform_alert_payment();

-- Existing companies as leads (won when paying, else trial).
insert into public.platform_leads (name, company, email, phone, source, stage, tenant_id, created_at)
select coalesce(t.contact_name, t.business_name), t.business_name, coalesce(t.contact_email, t.business_email), coalesce(t.contact_phone, t.business_phone), 'signup',
       case when s.status = 'active' then 'won' else 'trial' end, t.id, t.created_at
from public.tenants t
left join lateral (select status from public.subscriptions where tenant_id = t.id order by created_at desc limit 1) s on true
on conflict do nothing;
