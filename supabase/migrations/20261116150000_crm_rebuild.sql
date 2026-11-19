-- CRM rebuild: contacts of accounts, notes on any record, deal stage history, saved list views,
-- activities (tasks, meetings, calls) on any record, richer leads/accounts/deals and lead conversion.

-- Contacts: people, usually at an account (a customer).
create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  account_id uuid references public.customers(id) on delete set null,
  owner_id uuid,
  salutation text, first_name text, last_name text not null default '',
  title text, department text, email text, secondary_email text, phone text, mobile text,
  lead_source text, date_of_birth date, assistant text,
  mailing_street text, mailing_city text, mailing_state text, mailing_country text, mailing_code text,
  description text, email_opt_out boolean not null default false,
  ext_id text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists crm_contacts_tenant_idx on public.crm_contacts (tenant_id, last_name);
create index if not exists crm_contacts_account_idx on public.crm_contacts (account_id);
alter table public.crm_contacts enable row level security;
drop policy if exists crm_contacts_tenant on public.crm_contacts;
create policy crm_contacts_tenant on public.crm_contacts for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.crm_contacts to authenticated;

-- Notes on any CRM record.
create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  related_type text not null check (related_type in ('lead', 'contact', 'account', 'deal')),
  related_id uuid not null,
  title text, body text,
  ext_id text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists crm_notes_related_idx on public.crm_notes (tenant_id, related_type, related_id);
alter table public.crm_notes enable row level security;
drop policy if exists crm_notes_tenant on public.crm_notes;
create policy crm_notes_tenant on public.crm_notes for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.crm_notes to authenticated;

-- Saved list views (filters, columns and sort) per module.
create table if not exists public.crm_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  user_id uuid default auth.uid(),
  module text not null,
  name text not null,
  filters jsonb not null default '[]'::jsonb,
  columns text[],
  sort text,
  shared boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.crm_views enable row level security;
drop policy if exists crm_views_tenant on public.crm_views;
create policy crm_views_tenant on public.crm_views for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and (shared or user_id = auth.uid()))
  with check (tenant_id = public.current_user_tenant_id() and user_id = auth.uid());
grant select, insert, update, delete on public.crm_views to authenticated;

-- Activities on any record: tasks, meetings and calls.
alter table public.crm_activities alter column lead_id drop not null;
alter table public.crm_activities add column if not exists kind text not null default 'task';
alter table public.crm_activities add column if not exists related_type text;
alter table public.crm_activities add column if not exists related_id uuid;
alter table public.crm_activities add column if not exists contact_id uuid references public.crm_contacts(id) on delete set null;
alter table public.crm_activities add column if not exists start_at timestamptz;
alter table public.crm_activities add column if not exists end_at timestamptz;
alter table public.crm_activities add column if not exists status text not null default 'not_started';
alter table public.crm_activities add column if not exists priority text not null default 'normal';
alter table public.crm_activities add column if not exists location text;
alter table public.crm_activities add column if not exists call_type text;
alter table public.crm_activities add column if not exists call_result text;
alter table public.crm_activities add column if not exists duration_min integer;
alter table public.crm_activities add column if not exists reminder_at timestamptz;
update public.crm_activities set related_type = 'lead', related_id = lead_id where related_id is null and lead_id is not null;
create index if not exists crm_activities_related_idx on public.crm_activities (tenant_id, related_type, related_id);
create index if not exists crm_activities_open_idx on public.crm_activities (tenant_id, done, due_date);
alter table public.crm_activities drop constraint if exists crm_activities_kind_check;
alter table public.crm_activities add constraint crm_activities_kind_check check (kind in ('task', 'meeting', 'call'));

-- Leads: the fields a sales team keeps on a prospect, and where a conversion went.
alter table public.crm_leads add column if not exists first_name text;
alter table public.crm_leads add column if not exists last_name text;
alter table public.crm_leads add column if not exists title text;
alter table public.crm_leads add column if not exists lead_status text;
alter table public.crm_leads add column if not exists industry text;
alter table public.crm_leads add column if not exists rating text;
alter table public.crm_leads add column if not exists annual_revenue numeric;
alter table public.crm_leads add column if not exists employees integer;
alter table public.crm_leads add column if not exists email_opt_out boolean not null default false;
alter table public.crm_leads add column if not exists converted_account_id uuid;
alter table public.crm_leads add column if not exists converted_contact_id uuid;
alter table public.crm_leads add column if not exists converted_deal_id uuid;

-- Accounts are customers: the company facts a sales team keeps.
alter table public.customers add column if not exists website text;
alter table public.customers add column if not exists industry text;
alter table public.customers add column if not exists account_type text;
alter table public.customers add column if not exists annual_revenue numeric;
alter table public.customers add column if not exists employees integer;
alter table public.customers add column if not exists parent_account_id uuid references public.customers(id) on delete set null;
alter table public.customers add column if not exists description text;

-- Deals: the contact, the kind of deal and its campaign.
alter table public.crm_deals add column if not exists contact_id uuid references public.crm_contacts(id) on delete set null;
alter table public.crm_deals add column if not exists deal_type text;
alter table public.crm_deals add column if not exists campaign text;
alter table public.crm_deals add column if not exists ext_id text;

-- Every change of a deal's stage, amount, probability or closing date.
create table if not exists public.crm_deal_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  stage text, amount numeric, probability integer, closing_date date,
  changed_by uuid, changed_at timestamptz not null default now()
);
create index if not exists crm_deal_history_deal_idx on public.crm_deal_history (deal_id, changed_at);
alter table public.crm_deal_history enable row level security;
drop policy if exists crm_deal_history_read on public.crm_deal_history;
create policy crm_deal_history_read on public.crm_deal_history for select to authenticated using (tenant_id = public.current_user_tenant_id());
grant select on public.crm_deal_history to authenticated;

create or replace function public.crm_deal_history_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage or new.amount is distinct from old.amount
     or new.probability is distinct from old.probability or new.closing_date is distinct from old.closing_date then
    insert into public.crm_deal_history (tenant_id, deal_id, stage, amount, probability, closing_date, changed_by)
    values (new.tenant_id, new.id, new.stage, new.amount, new.probability, new.closing_date, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists crm_deal_history_log on public.crm_deals;
create trigger crm_deal_history_log after insert or update on public.crm_deals for each row execute function public.crm_deal_history_log();
-- Deals already here start their history now.
insert into public.crm_deal_history (tenant_id, deal_id, stage, amount, probability, closing_date, changed_at)
select d.tenant_id, d.id, d.stage, d.amount, d.probability, d.closing_date, d.created_at from public.crm_deals d
 where not exists (select 1 from public.crm_deal_history h where h.deal_id = d.id);

-- The old pipeline's opportunities become deals (the deals board is the pipeline now).
insert into public.crm_deals (tenant_id, name, customer_id, account_name, contact_name, phone, email, amount, stage, probability, closing_date, owner_id, source, lead_id, description, created_at)
select l.tenant_id, l.name, l.customer_id, l.partner_name, l.contact_name, coalesce(l.phone, l.mobile), l.email, coalesce(l.expected_revenue, 0),
       case l.won_status when 'won' then 'won' when 'lost' then 'lost' else 'qualification' end,
       case l.won_status when 'won' then 100 when 'lost' then 0 else greatest(coalesce(l.probability, 10)::int, 0) end,
       l.date_deadline, l.salesperson_id, l.source, l.id, l.description, l.created_at
  from public.crm_leads l
 where l.type = 'opportunity' and not exists (select 1 from public.crm_deals d where d.lead_id = l.id);

/**
 * Converts a lead: an account (customer, matched by name), a contact at it and, when asked, a deal.
 * The lead keeps its history and points at what it became.
 */
create or replace function public.crm_convert_lead(p_lead uuid, p_deal_name text default null, p_amount numeric default null,
  p_closing date default null, p_stage text default 'qualification')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare _l public.crm_leads; _acc uuid; _con uuid; _deal uuid; _company text; _first text; _last text;
begin
  select * into _l from public.crm_leads where id = p_lead and tenant_id = public.current_user_tenant_id();
  if _l.id is null then raise exception 'Lead not found'; end if;
  if _l.converted_contact_id is not null then raise exception 'This lead was converted already'; end if;
  _company := coalesce(nullif(trim(_l.partner_name), ''), nullif(trim(_l.name), ''));
  _first := coalesce(nullif(trim(_l.first_name), ''), split_part(coalesce(_l.contact_name, ''), ' ', 1));
  _last := coalesce(nullif(trim(_l.last_name), ''), nullif(trim(substr(coalesce(_l.contact_name, ''), length(split_part(coalesce(_l.contact_name, ''), ' ', 1)) + 1)), ''), _l.name);
  select id into _acc from public.customers where tenant_id = _l.tenant_id and lower(trim(name)) = lower(_company) limit 1;
  if _acc is null then
    insert into public.customers (tenant_id, name, phone, email, company_name, address, customer_type, source, website, industry, annual_revenue, employees, description)
    values (_l.tenant_id, _company, coalesce(_l.phone, _l.mobile, ''), _l.email, _company, nullif(concat_ws(', ', _l.street, _l.city, _l.country), ''),
            'business', coalesce(_l.source, 'CRM'), _l.website, _l.industry, _l.annual_revenue, _l.employees, _l.description)
    returning id into _acc;
  end if;
  insert into public.crm_contacts (tenant_id, account_id, owner_id, first_name, last_name, title, email, phone, mobile, lead_source, mailing_street, mailing_city, mailing_country, description, email_opt_out)
  values (_l.tenant_id, _acc, _l.salesperson_id, nullif(_first, ''), coalesce(_last, ''), _l.title, _l.email, _l.phone, _l.mobile, _l.source, _l.street, _l.city, _l.country, _l.description, _l.email_opt_out)
  returning id into _con;
  if nullif(trim(coalesce(p_deal_name, '')), '') is not null then
    insert into public.crm_deals (tenant_id, name, customer_id, account_name, contact_id, contact_name, phone, email, amount, stage, closing_date, owner_id, source, lead_id)
    values (_l.tenant_id, trim(p_deal_name), _acc, _company, _con, nullif(trim(concat_ws(' ', _first, _last)), ''), coalesce(_l.phone, _l.mobile), _l.email,
            coalesce(p_amount, _l.expected_revenue, 0), coalesce(p_stage, 'qualification'), p_closing, _l.salesperson_id, _l.source, _l.id)
    returning id into _deal;
  end if;
  -- Open activities and notes move with the lead to the contact.
  update public.crm_activities set related_type = 'contact', related_id = _con, contact_id = _con where related_type = 'lead' and related_id = _l.id;
  update public.crm_notes set related_type = 'contact', related_id = _con where related_type = 'lead' and related_id = _l.id;
  update public.crm_leads set converted_account_id = _acc, converted_contact_id = _con, converted_deal_id = _deal, customer_id = _acc,
         date_conversion = now(), lead_status = 'Converted', active = false, updated_at = now() where id = _l.id;
  return jsonb_build_object('account_id', _acc, 'contact_id', _con, 'deal_id', _deal);
end $$;
grant execute on function public.crm_convert_lead(uuid, text, numeric, date, text) to authenticated;
