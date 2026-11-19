-- JMSURF CALL CENTRE (callcentre.jmsurf.co.ke, its own app and repo) keeps its
-- data in this database so it shares sign-in, companies and customers with
-- JMSURF DASH. Telephony: Africa's Talking Voice (numbers, IVR, queues,
-- recordings) with agents answering in the browser over WebRTC.
-- Only the call centre's server writes calls; staff read their company's rows.

create table if not exists public.cc_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  at_username text,
  at_number text unique,
  enabled boolean not null default false,
  record_calls boolean not null default true,
  hours jsonb not null default '{"days":[1,2,3,4,5,6],"from":"08:00","to":"18:00","tz":180}'::jsonb,
  welcome_message text not null default 'Welcome. Thank you for calling.',
  closed_message text not null default 'We are closed right now. Please leave a message after the beep and we will call you back.',
  ivr jsonb not null default '[]'::jsonb,
  ring_seconds integer not null default 30,
  hold_music_url text,
  missed_sms text,
  missed_ticket boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.cc_queues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  strategy text not null default 'ring_all' check (strategy in ('ring_all', 'sequential')),
  created_at timestamptz not null default now()
);

create table if not exists public.cc_agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  user_id uuid not null,
  display_name text not null,
  client_name text not null unique default ('a' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
  mobile text,
  queue_ids uuid[] not null default '{}',
  status text not null default 'offline' check (status in ('offline', 'available', 'busy', 'away')),
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table if not exists public.cc_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id text not null unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_number text,
  to_number text,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  queue_id uuid references public.cc_queues(id) on delete set null,
  agent_id uuid references public.cc_agents(id) on delete set null,
  status text not null default 'ringing' check (status in ('ringing', 'menu', 'queued', 'answered', 'missed', 'voicemail', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  recording_url text,
  cost numeric(12,4),
  currency text,
  dtmf text,
  hangup_cause text,
  disposition text,
  notes text,
  ticket_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists cc_calls_tenant_idx on public.cc_calls (tenant_id, started_at desc);
create index if not exists cc_calls_customer_idx on public.cc_calls (customer_id, started_at desc);

create table if not exists public.cc_callbacks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  call_id uuid references public.cc_calls(id) on delete cascade,
  phone text not null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  status text not null default 'open' check (status in ('open', 'done')),
  assigned_to uuid,
  notes text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists cc_callbacks_open_idx on public.cc_callbacks (tenant_id, status, created_at desc);

-- Staff see their company's call centre; admins and managers change its setup;
-- notes, dispositions and callbacks can be updated by any staff member.
alter table public.cc_settings enable row level security;
alter table public.cc_queues enable row level security;
alter table public.cc_agents enable row level security;
alter table public.cc_calls enable row level security;
alter table public.cc_callbacks enable row level security;
revoke all on public.cc_settings, public.cc_queues, public.cc_agents, public.cc_calls, public.cc_callbacks from anon, authenticated;
grant select, insert, update, delete on public.cc_settings, public.cc_queues, public.cc_agents to authenticated;
grant select, update on public.cc_calls, public.cc_callbacks to authenticated;

do $$ declare t text; begin
  foreach t in array array['cc_settings', 'cc_queues', 'cc_agents', 'cc_calls', 'cc_callbacks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = public.current_user_tenant_id())', t || '_select', t);
  end loop;
  foreach t in array array['cc_settings', 'cc_queues', 'cc_agents'] loop
    execute format('drop policy if exists %I on public.%I', t || '_manage', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
      with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))$p$, t || '_manage', t);
  end loop;
  foreach t in array array['cc_calls', 'cc_callbacks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id())', t || '_update', t);
  end loop;
end $$;
-- Agents set their own availability.
drop policy if exists cc_agents_self on public.cc_agents;
create policy cc_agents_self on public.cc_agents for update to authenticated
  using (user_id = auth.uid() and tenant_id = public.current_user_tenant_id()) with check (user_id = auth.uid() and tenant_id = public.current_user_tenant_id());

do $$ declare t text; begin
  foreach t in array array['cc_calls', 'cc_agents', 'cc_callbacks'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

/** Last nine digits of a phone number, so 0712…, 254712… and +254712… match. */
create or replace function public.phone_key(p text) returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9)
$$;

/** Who is calling: the customer with this number in the signed-in company, with what matters for the call. */
create or replace function public.cc_screen_pop(p_phone text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); c record; k text := public.phone_key(p_phone);
begin
  if t is null or length(k) < 7 then return null; end if;
  select id, name, phone, email, company_name into c from public.customers where tenant_id = t and public.phone_key(phone) = k order by created_at limit 1;
  if not found then
    return jsonb_build_object('known', false, 'phone', p_phone,
      'lead', (select jsonb_build_object('id', id, 'name', coalesce(contact_name, name)) from public.crm_leads where tenant_id = t and (public.phone_key(phone) = k or public.phone_key(mobile) = k) limit 1));
  end if;
  return jsonb_build_object('known', true, 'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'company', c.company_name,
    'balance', (select coalesce(sum(total - coalesce(amount_paid, 0)), 0) from public.invoices where tenant_id = t and customer_id = c.id and status not in ('draft', 'void', 'paid')),
    'overdue', (select count(*) from public.invoices where tenant_id = t and customer_id = c.id and status not in ('draft', 'void', 'paid') and due_date < current_date),
    'last_invoice', (select jsonb_build_object('number', invoice_number, 'total', total, 'date', issue_date) from public.invoices where tenant_id = t and customer_id = c.id and status <> 'void' order by issue_date desc nulls last limit 1),
    'open_tickets', (select count(*) from public.app_records where tenant_id = t and app = 'helpdesk' and customer_id = c.id and stage in ('new', 'in_progress', 'waiting')),
    'open_deals', (select coalesce(sum(expected_revenue), 0) from public.crm_leads where tenant_id = t and customer_id = c.id and active and type = 'opportunity'),
    'calls', (select count(*) from public.cc_calls where tenant_id = t and customer_id = c.id));
end $$;
revoke all on function public.cc_screen_pop(text) from public, anon;
grant execute on function public.cc_screen_pop(text) to authenticated;

-- Secret part of each company's voice callback URL (AT callbacks are not signed).
alter table public.cc_settings add column if not exists callback_key text not null default encode(gen_random_bytes(16), 'hex');
