-- JMSURF DASH: CRM modelled on classic CRM (crm.lead, crm.stage, crm.team,
-- crm.tag, crm.lost.reason, mail.activity, mail.message).

create table if not exists public.crm_teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  leader_id uuid,
  member_ids uuid[] not null default '{}',
  invoiced_target numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sequence integer not null default 1,
  is_won boolean not null default false,
  fold boolean not null default false,
  team_id uuid references public.crm_teams(id) on delete set null,
  requirements text,
  created_at timestamptz not null default now()
);
create table if not exists public.crm_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  color integer not null default 0,
  unique (tenant_id, name)
);
create table if not exists public.crm_lost_reasons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true
);
create table if not exists public.crm_activity_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  icon text not null default 'check',
  default_days integer not null default 0,
  sequence integer not null default 1,
  active boolean not null default true
);
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type text not null default 'opportunity' check (type in ('lead', 'opportunity')),
  name text not null,
  partner_name text,                 -- company
  contact_name text,
  customer_id uuid references public.customers(id) on delete set null,
  email text,
  phone text,
  mobile text,
  website text,
  street text,
  city text,
  country text default 'Kenya',
  salesperson_id uuid,
  team_id uuid references public.crm_teams(id) on delete set null,
  stage_id uuid references public.crm_stages(id) on delete set null,
  probability numeric not null default 10 check (probability between 0 and 100),
  expected_revenue numeric not null default 0,
  date_deadline date,                -- expected closing
  priority integer not null default 0 check (priority between 0 and 3),
  tag_ids uuid[] not null default '{}',
  color integer not null default 0,
  description text,                  -- internal notes
  source text,
  medium text,
  campaign text,
  referred text,
  active boolean not null default true,
  won_status text not null default 'pending' check (won_status in ('pending', 'won', 'lost')),
  lost_reason_id uuid references public.crm_lost_reasons(id) on delete set null,
  lost_feedback text,
  date_closed timestamptz,
  date_conversion timestamptz,
  date_last_stage_update timestamptz not null default now(),
  sequence integer not null default 10,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_leads_tenant_idx on public.crm_leads (tenant_id, type, active, stage_id);
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  type_id uuid references public.crm_activity_types(id) on delete set null,
  summary text,
  note text,
  due_date date not null default current_date,
  assigned_to uuid,
  done boolean not null default false,
  done_at timestamptz,
  feedback text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists crm_activities_due_idx on public.crm_activities (tenant_id, done, due_date);
create index if not exists crm_activities_lead_idx on public.crm_activities (lead_id);
create table if not exists public.crm_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  kind text not null default 'note' check (kind in ('message', 'note', 'log')),
  body text,
  tracking jsonb,                    -- [{field, old, new}]
  author_id uuid,
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists crm_messages_lead_idx on public.crm_messages (lead_id, created_at);

alter table public.quotes add column if not exists lead_id uuid references public.crm_leads(id) on delete set null;

do $$ declare t text; begin
  foreach t in array array['crm_teams', 'crm_stages', 'crm_tags', 'crm_lost_reasons', 'crm_activity_types', 'crm_leads', 'crm_activities', 'crm_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant', t);
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id())', t || '_tenant', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

/** Chatter tracking: stage, salesperson, revenue, probability and won/lost changes are logged. */
create or replace function public.crm_lead_track() returns trigger
language plpgsql security definer set search_path = public as $$
declare trk jsonb := '[]'::jsonb; who text; won boolean;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if new.stage_id is distinct from old.stage_id then
      new.date_last_stage_update := now();
      select is_won into won from public.crm_stages where id = new.stage_id;
      if won then new.won_status := 'won'; new.probability := 100; new.date_closed := coalesce(new.date_closed, now());
      elsif old.won_status = 'won' then new.won_status := 'pending'; new.date_closed := null;
      end if;
      trk := trk || jsonb_build_array(jsonb_build_object('field', 'Stage', 'old', (select name from public.crm_stages where id = old.stage_id), 'new', (select name from public.crm_stages where id = new.stage_id)));
    end if;
    if new.salesperson_id is distinct from old.salesperson_id then
      trk := trk || jsonb_build_array(jsonb_build_object('field', 'Salesperson', 'old', (select display_name from public.profiles where user_id = old.salesperson_id), 'new', (select display_name from public.profiles where user_id = new.salesperson_id)));
    end if;
    if new.expected_revenue is distinct from old.expected_revenue then
      trk := trk || jsonb_build_array(jsonb_build_object('field', 'Expected Revenue', 'old', old.expected_revenue, 'new', new.expected_revenue));
    end if;
    if new.probability is distinct from old.probability then
      trk := trk || jsonb_build_array(jsonb_build_object('field', 'Probability', 'old', old.probability, 'new', new.probability));
    end if;
    if new.won_status is distinct from old.won_status then
      trk := trk || jsonb_build_array(jsonb_build_object('field', 'Status', 'old', old.won_status, 'new', new.won_status));
    end if;
    if new.type is distinct from old.type and new.type = 'opportunity' then
      new.date_conversion := now();
      trk := trk || jsonb_build_array(jsonb_build_object('field', 'Type', 'old', 'Lead', 'new', 'Opportunity'));
    end if;
    if jsonb_array_length(trk) > 0 then
      select display_name into who from public.profiles where user_id = auth.uid();
      insert into public.crm_messages (tenant_id, lead_id, kind, tracking, author_id, author_name)
      values (new.tenant_id, new.id, 'log', trk, auth.uid(), coalesce(who, 'System'));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists crm_lead_track on public.crm_leads;
create trigger crm_lead_track before update on public.crm_leads for each row execute function public.crm_lead_track();

create or replace function public.crm_lead_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select display_name into who from public.profiles where user_id = auth.uid();
  insert into public.crm_messages (tenant_id, lead_id, kind, body, author_id, author_name)
  values (new.tenant_id, new.id, 'log', case when new.type = 'lead' then 'Lead created' else 'Opportunity created' end, auth.uid(), coalesce(who, 'System'));
  return null;
end $$;
drop trigger if exists crm_lead_created on public.crm_leads;
create trigger crm_lead_created after insert on public.crm_leads for each row execute function public.crm_lead_created();

-- Default configuration, as a fresh CRM ships it.
do $$
declare t uuid; team uuid; owner uuid;
begin
  for t, owner in select id, owner_user_id from public.tenants loop
    if exists (select 1 from public.crm_stages where tenant_id = t) then continue; end if;
    insert into public.crm_teams (tenant_id, name, leader_id, member_ids) values (t, 'Sales', owner, array_remove(array[owner], null)) returning id into team;
    insert into public.crm_stages (tenant_id, name, sequence, is_won) values
      (t, 'New', 1, false), (t, 'Qualified', 2, false), (t, 'Proposition', 3, false), (t, 'Won', 4, true);
    insert into public.crm_tags (tenant_id, name, color) values
      (t, 'Product', 1), (t, 'Services', 2), (t, 'Information', 3), (t, 'Grooming', 4), (t, 'Wholesale', 5), (t, 'Vet Clinic', 6), (t, 'Breeder', 7), (t, 'Other', 8);
    insert into public.crm_lost_reasons (tenant_id, name) values
      (t, 'Too expensive'), (t, 'Not enough stock'), (t, 'Went to a competitor'), (t, 'No longer interested');
    insert into public.crm_activity_types (tenant_id, name, icon, default_days, sequence) values
      (t, 'Email', 'mail', 0, 1), (t, 'Call', 'phone', 2, 2), (t, 'Meeting', 'users', 0, 3), (t, 'To-Do', 'check', 5, 4), (t, 'Upload Document', 'upload', 5, 5);
  end loop;
end $$;

alter publication supabase_realtime add table public.crm_leads, public.crm_activities, public.crm_messages;
