-- Service & Marketing integrations (engage.js):
--  * messages on records (helpdesk email threads, website live chat)
--  * email campaign sends with open tracking and unsubscribes
--  * automation journey enrolments
--  * IoT readings
--  * event tickets paid through invoices
alter table public.app_record_events drop constraint if exists app_record_events_kind_check;
alter table public.app_record_events add constraint app_record_events_kind_check check (kind in ('comment', 'change', 'stage', 'file', 'system', 'message'));
create index if not exists app_record_events_msg_idx on public.app_record_events (record_id, created_at) where kind = 'message';
create index if not exists app_records_data_key_idx on public.app_records ((data->>'key_hash')) where app = 'iot';
create index if not exists app_records_chat_idx on public.app_records ((data->>'visitor_hash')) where app = 'live_chat';

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'app_record_events') then
    alter publication supabase_realtime add table public.app_record_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'app_records') then
    alter publication supabase_realtime add table public.app_records;
  end if;
end $$;

create table if not exists public.marketing_sends (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.app_records(id) on delete cascade,
  email text not null,
  name text,
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  error text,
  sent_at timestamptz,
  opened_at timestamptz,
  open_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (campaign_id, email)
);
create index if not exists marketing_sends_queue_idx on public.marketing_sends (campaign_id, status);

create table if not exists public.marketing_unsubscribes (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, email)
);

create table if not exists public.journey_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  journey_id uuid not null references public.app_records(id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  name text,
  phone text,
  email text,
  step integer not null default 0,
  next_at timestamptz not null default now(),
  done boolean not null default false,
  log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (journey_id, subject_type, subject_id)
);
create index if not exists journey_enrollments_due_idx on public.journey_enrollments (next_at) where not done;

create table if not exists public.iot_readings (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_id uuid not null references public.app_records(id) on delete cascade,
  metric text,
  value numeric,
  unit text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists iot_readings_device_idx on public.iot_readings (device_id, created_at desc);

-- Company staff can read these; only the app server writes them.
do $$ declare t text; begin
  foreach t in array array['marketing_sends', 'marketing_unsubscribes', 'journey_enrollments', 'iot_readings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = public.current_user_tenant_id())', t || '_select', t);
  end loop;
end $$;
grant delete on public.marketing_unsubscribes to authenticated;
drop policy if exists marketing_unsubscribes_delete on public.marketing_unsubscribes;
create policy marketing_unsubscribes_delete on public.marketing_unsubscribes for delete to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));

-- Event tickets: when the ticket's invoice is paid, the registration is paid.
create or replace function public.event_ticket_paid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'paid' and coalesce(OLD.status, '') <> 'paid' and NEW.source = 'event' then
    update public.app_records set stage = 'paid', amount = NEW.total, updated_at = now()
    where tenant_id = NEW.tenant_id and app = 'events' and kind = 'registration' and data->>'invoice_id' = NEW.id::text and stage = 'registered';
  end if;
  return NEW;
end $$;
revoke all on function public.event_ticket_paid() from public, anon, authenticated;
drop trigger if exists invoices_event_ticket_paid on public.invoices;
create trigger invoices_event_ticket_paid after update of status on public.invoices
  for each row execute function public.event_ticket_paid();
