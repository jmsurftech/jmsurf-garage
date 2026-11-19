-- JMSURF Garage: workshop core.
-- Vehicles (with ownership history and mileage log), bays, bookings, job cards with lines,
-- events, time logs, media, part requests, inspections, estimates with per-line approval,
-- service menus, job templates, technical notes, reminders log and per-company settings.
-- Every table is per company (tenant_id) with the same RLS rule as the rest of the app.
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------- helpers

create or replace function public.garage_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

/** Number plate as stored: upper case, letters and digits only ("kca 123a" → "KCA123A"). */
create or replace function public.garage_plate(p text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;
grant execute on function public.garage_plate(text) to authenticated, anon, service_role;

-- Running numbers per company (JOB-00001, BK-00001, INS-00001).
create table if not exists public.garage_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  last_no integer not null default 0,
  primary key (tenant_id, kind)
);
alter table public.garage_counters enable row level security;
drop policy if exists garage_counters_tenant on public.garage_counters;
create policy garage_counters_tenant on public.garage_counters for select to authenticated
  using (tenant_id = public.current_user_tenant_id());
grant select on public.garage_counters to authenticated;

create or replace function public.garage_next_no(p_tenant uuid, p_kind text, p_prefix text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare n integer;
begin
  insert into public.garage_counters (tenant_id, kind, last_no) values (p_tenant, p_kind, 1)
  on conflict (tenant_id, kind) do update set last_no = public.garage_counters.last_no + 1
  returning last_no into n;
  return p_prefix || lpad(n::text, 5, '0');
end $$;
revoke all on function public.garage_next_no(uuid, text, text) from public, anon, authenticated;
grant execute on function public.garage_next_no(uuid, text, text) to service_role;

-- ---------------------------------------------------------------- settings

create table if not exists public.garage_settings (
  tenant_id uuid primary key default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  booking_enabled boolean not null default false,
  booking_intro text,
  booking_services text[] not null default '{}',
  slot_minutes integer not null default 60,
  open_hour integer not null default 8,
  close_hour integer not null default 17,
  open_days integer[] not null default '{1,2,3,4,5,6}',
  checkin_terms text,
  qc_checklist jsonb not null default '[]'::jsonb,
  service_interval_months integer not null default 6,
  service_interval_km integer not null default 5000,
  estimate_valid_days integer not null default 14,
  labour_rate numeric not null default 0,
  default_location_id uuid,
  reminders jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.garage_settings enable row level security;
drop policy if exists garage_settings_tenant on public.garage_settings;
create policy garage_settings_tenant on public.garage_settings for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update on public.garage_settings to authenticated;
drop trigger if exists garage_settings_touch on public.garage_settings;
create trigger garage_settings_touch before update on public.garage_settings for each row execute function public.garage_touch();

-- ---------------------------------------------------------------- bays

create table if not exists public.garage_bays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  kind text not null default 'bay' check (kind in ('bay', 'lift', 'pit', 'wash', 'paint_booth', 'outside')),
  branch text,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists garage_bays_tenant_idx on public.garage_bays (tenant_id, sort);
alter table public.garage_bays enable row level security;
drop policy if exists garage_bays_tenant on public.garage_bays;
create policy garage_bays_tenant on public.garage_bays for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_bays to authenticated;

-- ---------------------------------------------------------------- vehicles

create table if not exists public.garage_vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  plate text not null,
  make text, model text, year integer, engine text, transmission text, fuel text, colour text,
  vin text, engine_no text,
  vehicle_type text not null default 'car' check (vehicle_type in ('car', 'pickup', 'SUV', 'van', 'truck', 'bus', 'matatu', 'motorbike', 'tuk-tuk', 'tractor', 'generator', 'other')),
  mileage integer,
  insurance_expiry date, inspection_expiry date, speed_governor_expiry date, psv_expiry date,
  next_service_date date, next_service_km integer, last_service_at timestamptz,
  notes text,
  photos jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.garage_vehicles add column if not exists next_service_date date;
alter table public.garage_vehicles add column if not exists next_service_km integer;
alter table public.garage_vehicles add column if not exists last_service_at timestamptz;
create unique index if not exists garage_vehicles_plate_uq on public.garage_vehicles (tenant_id, plate);
create index if not exists garage_vehicles_customer_idx on public.garage_vehicles (tenant_id, customer_id);
create index if not exists garage_vehicles_vin_idx on public.garage_vehicles (tenant_id, vin) where vin is not null;
alter table public.garage_vehicles enable row level security;
drop policy if exists garage_vehicles_tenant on public.garage_vehicles;
create policy garage_vehicles_tenant on public.garage_vehicles for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_vehicles to authenticated;

create table if not exists public.garage_vehicle_owners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  vehicle_id uuid not null references public.garage_vehicles(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  from_date timestamptz not null default now(),
  to_date timestamptz,
  note text,
  created_by uuid default auth.uid()
);
create index if not exists garage_vehicle_owners_vehicle_idx on public.garage_vehicle_owners (vehicle_id, from_date desc);
alter table public.garage_vehicle_owners enable row level security;
drop policy if exists garage_vehicle_owners_tenant on public.garage_vehicle_owners;
create policy garage_vehicle_owners_tenant on public.garage_vehicle_owners for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_vehicle_owners to authenticated;

create table if not exists public.garage_mileage_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  vehicle_id uuid not null references public.garage_vehicles(id) on delete cascade,
  mileage integer not null,
  source text not null default 'manual',
  job_id uuid,
  recorded_at timestamptz not null default now(),
  recorded_by uuid default auth.uid()
);
create index if not exists garage_mileage_log_vehicle_idx on public.garage_mileage_log (vehicle_id, recorded_at desc);
alter table public.garage_mileage_log enable row level security;
drop policy if exists garage_mileage_log_tenant on public.garage_mileage_log;
create policy garage_mileage_log_tenant on public.garage_mileage_log for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, delete on public.garage_mileage_log to authenticated;

/** Plate tidy-up, owner history and mileage log on every vehicle change. */
create or replace function public.garage_vehicle_before() returns trigger language plpgsql as $$
begin
  new.plate := public.garage_plate(new.plate);
  if new.plate = '' then raise exception 'Enter the number plate'; end if;
  new.vin := nullif(upper(regexp_replace(coalesce(new.vin, ''), '\s', '', 'g')), '');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists garage_vehicle_before on public.garage_vehicles;
create trigger garage_vehicle_before before insert or update on public.garage_vehicles for each row execute function public.garage_vehicle_before();

create or replace function public.garage_vehicle_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id then
    update public.garage_vehicle_owners set to_date = now() where vehicle_id = new.id and to_date is null;
    if new.customer_id is not null then
      insert into public.garage_vehicle_owners (tenant_id, vehicle_id, customer_id) values (new.tenant_id, new.id, new.customer_id);
    end if;
  end if;
  -- Skip when the same reading was just logged (check-in or a manual reading saved first).
  if new.mileage is not null and (tg_op = 'INSERT' or new.mileage is distinct from old.mileage)
     and not exists (select 1 from public.garage_mileage_log where vehicle_id = new.id and mileage = new.mileage and recorded_at > now() - interval '1 minute') then
    insert into public.garage_mileage_log (tenant_id, vehicle_id, mileage, source) values (new.tenant_id, new.id, new.mileage, 'vehicle');
  end if;
  return new;
end $$;
drop trigger if exists garage_vehicle_after on public.garage_vehicles;
create trigger garage_vehicle_after after insert or update of customer_id, mileage on public.garage_vehicles for each row execute function public.garage_vehicle_after();

-- Reminder consent per customer (service reminders on by default; offers off until the customer agrees).
alter table public.customers add column if not exists garage_reminders_ok boolean not null default true;
alter table public.customers add column if not exists garage_offers_ok boolean not null default false;

-- ---------------------------------------------------------------- bookings

create table if not exists public.garage_bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  booking_no text,
  customer_id uuid references public.customers(id) on delete set null,
  vehicle_id uuid references public.garage_vehicles(id) on delete set null,
  name text, phone text, plate text, vehicle_desc text,
  service text, notes text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  bay_id uuid references public.garage_bays(id) on delete set null,
  mechanic_id uuid,
  source text not null default 'walk_in' check (source in ('online', 'whatsapp', 'phone', 'walk_in', 'staff')),
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'arrived', 'no_show', 'cancelled')),
  job_id uuid,
  confirm_sent_at timestamptz,
  reminder_sent_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists garage_bookings_when_idx on public.garage_bookings (tenant_id, starts_at);
alter table public.garage_bookings enable row level security;
drop policy if exists garage_bookings_tenant on public.garage_bookings;
create policy garage_bookings_tenant on public.garage_bookings for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_bookings to authenticated;

create or replace function public.garage_booking_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and coalesce(new.booking_no, '') = '' then new.booking_no := public.garage_next_no(new.tenant_id, 'booking', 'BK-'); end if;
  new.plate := nullif(public.garage_plate(new.plate), '');
  if new.ends_at is null then new.ends_at := new.starts_at + interval '1 hour'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists garage_booking_before on public.garage_bookings;
create trigger garage_booking_before before insert or update on public.garage_bookings for each row execute function public.garage_booking_before();

-- ---------------------------------------------------------------- jobs

create table if not exists public.garage_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  job_no text,
  vehicle_id uuid references public.garage_vehicles(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  booking_id uuid references public.garage_bookings(id) on delete set null,
  status text not null default 'checked_in' check (status in ('booked', 'checked_in', 'diagnosing', 'waiting_approval', 'waiting_parts', 'in_progress', 'quality_check', 'ready', 'collected', 'cancelled')),
  job_type text not null default 'mechanical' check (job_type in ('mechanical', 'body_paint', 'tyres', 'wash', 'towing', 'inspection', 'prep', 'warranty')),
  source jsonb,
  bay text,
  bay_id uuid references public.garage_bays(id) on delete set null,
  branch text,
  location_id uuid,
  service_advisor_id uuid default auth.uid(),
  mechanic_ids uuid[] not null default '{}',
  promised_at timestamptz,
  mileage_in integer, mileage_out integer,
  fuel_level text,
  complaint text, findings text, internal_notes text, customer_notes text,
  obd_codes jsonb not null default '[]'::jsonb,
  checkin jsonb not null default '{}'::jsonb,
  qc jsonb,
  invoice_id uuid references public.invoices(id) on delete set null,
  estimate_subtotal numeric not null default 0,
  estimate_tax numeric not null default 0,
  estimate_total numeric not null default 0,
  approved_total numeric not null default 0,
  payer_split jsonb,
  deposit_amount numeric,
  deposit_requested_at timestamptz,
  comeback_of uuid references public.garage_jobs(id) on delete set null,
  comeback_reason text,
  warranty_cost numeric,
  warranty_mechanic_id uuid,
  warranty_supplier_id uuid,
  tracking_token text unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  stage_entered_at timestamptz not null default now(),
  stage_minutes jsonb not null default '{}'::jsonb,
  checked_in_at timestamptz,
  ready_at timestamptz,
  collected_at timestamptz,
  gate_released_at timestamptz,
  gate_released_by uuid,
  gate_on_credit boolean not null default false,
  rating integer check (rating between 1 and 5),
  mechanic_rating integer check (mechanic_rating between 1 and 5),
  rating_comment text,
  rated_at timestamptz,
  ready_sms_sent_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists garage_jobs_no_uq on public.garage_jobs (tenant_id, job_no);
create index if not exists garage_jobs_status_idx on public.garage_jobs (tenant_id, status, created_at desc);
create index if not exists garage_jobs_vehicle_idx on public.garage_jobs (vehicle_id, created_at desc);
create index if not exists garage_jobs_customer_idx on public.garage_jobs (tenant_id, customer_id);
create index if not exists garage_jobs_comeback_idx on public.garage_jobs (comeback_of) where comeback_of is not null;
alter table public.garage_jobs enable row level security;
drop policy if exists garage_jobs_tenant on public.garage_jobs;
create policy garage_jobs_tenant on public.garage_jobs for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_jobs to authenticated;

alter table public.garage_bookings drop constraint if exists garage_bookings_job_fk;
alter table public.garage_bookings add constraint garage_bookings_job_fk foreign key (job_id) references public.garage_jobs(id) on delete set null;

create table if not exists public.garage_job_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  job_id uuid not null references public.garage_jobs(id) on delete cascade,
  kind text not null default 'status',
  from_status text, to_status text,
  note text,
  minutes_in_stage numeric,
  by_user uuid default auth.uid(),
  by_name text,
  at timestamptz not null default now()
);
create index if not exists garage_job_events_job_idx on public.garage_job_events (job_id, at);
alter table public.garage_job_events enable row level security;
drop policy if exists garage_job_events_tenant on public.garage_job_events;
create policy garage_job_events_tenant on public.garage_job_events for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert on public.garage_job_events to authenticated;

/** The status flow. Cancelled can be reached from any open stage; collected only through the gate. */
create or replace function public.garage_status_allowed(p_from text, p_to text) returns boolean language sql immutable as $$
  select p_from = p_to
    or p_to = 'cancelled' and p_from not in ('collected', 'cancelled')
    or (p_from, p_to) in (
      ('booked', 'checked_in'),
      ('checked_in', 'diagnosing'), ('checked_in', 'waiting_approval'), ('checked_in', 'in_progress'), ('checked_in', 'waiting_parts'),
      ('diagnosing', 'waiting_approval'), ('diagnosing', 'waiting_parts'), ('diagnosing', 'in_progress'),
      ('waiting_approval', 'waiting_parts'), ('waiting_approval', 'in_progress'), ('waiting_approval', 'diagnosing'), ('waiting_approval', 'ready'),
      ('waiting_parts', 'in_progress'), ('waiting_parts', 'waiting_approval'),
      ('in_progress', 'waiting_parts'), ('in_progress', 'waiting_approval'), ('in_progress', 'quality_check'),
      ('quality_check', 'in_progress'), ('quality_check', 'ready'),
      ('ready', 'in_progress'), ('ready', 'collected'),
      ('cancelled', 'checked_in'))
$$;
grant execute on function public.garage_status_allowed(text, text) to authenticated, service_role;

create or replace function public.garage_job_before() returns trigger language plpgsql security definer set search_path = public as $$
declare mins numeric;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.job_no, '') = '' then new.job_no := public.garage_next_no(new.tenant_id, 'job', 'JOB-'); end if;
    if new.status <> 'booked' and new.checked_in_at is null then new.checked_in_at := now(); end if;
    new.stage_entered_at := now();
    return new;
  end if;
  new.updated_at := now();
  if new.status is distinct from old.status then
    if not public.garage_status_allowed(old.status, new.status) then
      raise exception 'A job cannot go from % to %', replace(old.status, '_', ' '), replace(new.status, '_', ' ');
    end if;
    if new.status = 'collected' and new.gate_released_at is null then
      raise exception 'Release the car at the gate first: it must be paid or approved on credit';
    end if;
    if new.status = 'ready' and old.status <> 'quality_check' and old.status <> 'waiting_approval' then
      raise exception 'Do the quality check before marking the car ready';
    end if;
    mins := round(extract(epoch from (now() - old.stage_entered_at)) / 60.0, 1);
    new.stage_minutes := coalesce(old.stage_minutes, '{}'::jsonb)
      || jsonb_build_object(old.status, coalesce((old.stage_minutes->>old.status)::numeric, 0) + greatest(mins, 0));
    new.stage_entered_at := now();
    if new.status = 'checked_in' and new.checked_in_at is null then new.checked_in_at := now(); end if;
    if new.status = 'ready' then new.ready_at := now(); end if;
    if new.status = 'collected' then new.collected_at := now(); end if;
    insert into public.garage_job_events (tenant_id, job_id, kind, from_status, to_status, minutes_in_stage, by_user)
    values (new.tenant_id, new.id, 'status', old.status, new.status, greatest(mins, 0), auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists garage_job_before on public.garage_jobs;
create trigger garage_job_before before insert or update on public.garage_jobs for each row execute function public.garage_job_before();

/** After a job: log the first status, the mileage in, and set the next service when collected. */
create or replace function public.garage_job_after() returns trigger language plpgsql security definer set search_path = public as $$
declare s public.garage_settings;
begin
  if tg_op = 'INSERT' then
    insert into public.garage_job_events (tenant_id, job_id, kind, to_status, by_user) values (new.tenant_id, new.id, 'status', new.status, auth.uid());
  end if;
  if new.vehicle_id is not null and new.mileage_in is not null and (tg_op = 'INSERT' or new.mileage_in is distinct from old.mileage_in) then
    insert into public.garage_mileage_log (tenant_id, vehicle_id, mileage, source, job_id) values (new.tenant_id, new.vehicle_id, new.mileage_in, 'check_in', new.id);
    update public.garage_vehicles set mileage = greatest(coalesce(mileage, 0), new.mileage_in) where id = new.vehicle_id and coalesce(mileage, 0) < new.mileage_in;
  end if;
  if tg_op = 'UPDATE' and new.status = 'collected' and old.status <> 'collected' and new.vehicle_id is not null and new.job_type in ('mechanical', 'warranty') then
    select * into s from public.garage_settings where tenant_id = new.tenant_id;
    update public.garage_vehicles set
      last_service_at = now(),
      next_service_date = (now() + make_interval(months => coalesce(s.service_interval_months, 6)))::date,
      next_service_km = case when coalesce(new.mileage_out, new.mileage_in) is not null then coalesce(new.mileage_out, new.mileage_in) + coalesce(s.service_interval_km, 5000) else next_service_km end
     where id = new.vehicle_id;
  end if;
  return new;
end $$;
drop trigger if exists garage_job_after on public.garage_jobs;
create trigger garage_job_after after insert or update on public.garage_jobs for each row execute function public.garage_job_after();

-- Job lines: labour, parts, sublet, consumables.
create table if not exists public.garage_job_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  job_id uuid not null references public.garage_jobs(id) on delete cascade,
  kind text not null default 'labour' check (kind in ('labour', 'part', 'sublet', 'consumable')),
  item_id uuid references public.products(id) on delete set null,
  service_menu_id uuid,
  description text not null default '',
  pricing text not null default 'fixed' check (pricing in ('fixed', 'hourly', 'menu')),
  hours numeric,
  qty numeric not null default 1,
  rate numeric not null default 0,
  discount numeric not null default 0,
  tax_rate numeric not null default 0,
  cost numeric,
  supplier_id uuid,
  priority text not null default 'must' check (priority in ('must', 'advised', 'optional')),
  approved boolean,
  approved_at timestamptz,
  approved_via text,
  mechanic_ids uuid[] not null default '{}',
  payer text not null default 'customer' check (payer in ('customer', 'insurer', 'fleet')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  issued_qty numeric not null default 0,
  invoice_id uuid references public.invoices(id) on delete set null,
  is_extra boolean not null default false,
  note text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists garage_job_lines_job_idx on public.garage_job_lines (job_id, sort);
create index if not exists garage_job_lines_mech_idx on public.garage_job_lines using gin (mechanic_ids);
alter table public.garage_job_lines enable row level security;
drop policy if exists garage_job_lines_tenant on public.garage_job_lines;
create policy garage_job_lines_tenant on public.garage_job_lines for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_job_lines to authenticated;
drop trigger if exists garage_job_lines_touch on public.garage_job_lines;
create trigger garage_job_lines_touch before update on public.garage_job_lines for each row execute function public.garage_touch();

/** Keeps the job's estimate and approved totals in step with its lines. */
create or replace function public.garage_job_totals(p_job uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.garage_jobs j set
    estimate_subtotal = coalesce(t.sub, 0), estimate_tax = coalesce(t.tax, 0), estimate_total = coalesce(t.sub, 0) + coalesce(t.tax, 0),
    approved_total = coalesce(t.appr, 0)
  from (
    select sum(round(qty * rate * (1 - least(greatest(discount, 0), 100) / 100), 2)) filter (where status <> 'cancelled') sub,
           sum(round(qty * rate * (1 - least(greatest(discount, 0), 100) / 100) * tax_rate / 100, 2)) filter (where status <> 'cancelled') tax,
           sum(round(qty * rate * (1 - least(greatest(discount, 0), 100) / 100) * (1 + tax_rate / 100), 2)) filter (where status <> 'cancelled' and approved is true) appr
      from public.garage_job_lines where job_id = p_job
  ) t
  where j.id = p_job;
end $$;
revoke all on function public.garage_job_totals(uuid) from public, anon;
grant execute on function public.garage_job_totals(uuid) to authenticated, service_role;

create or replace function public.garage_job_lines_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.garage_job_totals(coalesce(new.job_id, old.job_id));
  return null;
end $$;
drop trigger if exists garage_job_lines_after on public.garage_job_lines;
create trigger garage_job_lines_after after insert or update or delete on public.garage_job_lines for each row execute function public.garage_job_lines_after();

-- Mechanic clock on / off per line.
create table if not exists public.garage_time_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  job_id uuid not null references public.garage_jobs(id) on delete cascade,
  line_id uuid references public.garage_job_lines(id) on delete cascade,
  mechanic_id uuid not null default auth.uid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  minutes numeric generated always as (case when ended_at is null then null else round(extract(epoch from (ended_at - started_at)) / 60.0, 1) end) stored,
  note text
);
create index if not exists garage_time_logs_job_idx on public.garage_time_logs (job_id);
create index if not exists garage_time_logs_mech_idx on public.garage_time_logs (tenant_id, mechanic_id, started_at desc);
create unique index if not exists garage_time_logs_one_open on public.garage_time_logs (mechanic_id, line_id) where ended_at is null;
alter table public.garage_time_logs enable row level security;
drop policy if exists garage_time_logs_tenant on public.garage_time_logs;
create policy garage_time_logs_tenant on public.garage_time_logs for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_time_logs to authenticated;

-- Photos, videos and voice notes (files in the documents bucket under <tenant>/garage/<job>/).
create table if not exists public.garage_job_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  job_id uuid references public.garage_jobs(id) on delete cascade,
  line_id uuid references public.garage_job_lines(id) on delete set null,
  vehicle_id uuid references public.garage_vehicles(id) on delete cascade,
  inspection_id uuid,
  stage text not null default 'job' check (stage in ('check_in', 'job', 'inspection', 'quality_check', 'collection', 'vehicle')),
  kind text not null default 'photo' check (kind in ('photo', 'video', 'voice', 'file')),
  path text not null,
  mime_type text,
  caption text,
  customer_visible boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists garage_job_media_job_idx on public.garage_job_media (job_id, created_at);
alter table public.garage_job_media enable row level security;
drop policy if exists garage_job_media_tenant on public.garage_job_media;
create policy garage_job_media_tenant on public.garage_job_media for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_job_media to authenticated;

-- Parts asked for from a job; the store issues them from stock (and takes back what was not used).
create table if not exists public.garage_part_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  job_id uuid not null references public.garage_jobs(id) on delete cascade,
  line_id uuid references public.garage_job_lines(id) on delete cascade,
  item_id uuid references public.products(id) on delete set null,
  description text,
  qty numeric not null default 1,
  issued_qty numeric not null default 0,
  returned_qty numeric not null default 0,
  location_id uuid,
  status text not null default 'requested' check (status in ('requested', 'issued', 'partly_issued', 'returned', 'cancelled', 'to_order')),
  note text,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  issued_by uuid, issued_at timestamptz
);
create index if not exists garage_part_requests_open_idx on public.garage_part_requests (tenant_id, status, requested_at);
create index if not exists garage_part_requests_job_idx on public.garage_part_requests (job_id);
alter table public.garage_part_requests enable row level security;
drop policy if exists garage_part_requests_tenant on public.garage_part_requests;
create policy garage_part_requests_tenant on public.garage_part_requests for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_part_requests to authenticated;

/**
 * Issues (p_qty > 0) or takes back (p_qty < 0) parts of a request through the normal stock movement,
 * so stock on hand, batches and the stock history stay right. Unused parts come back the same way.
 */
create or replace function public.garage_issue_part(p_request uuid, p_qty numeric, p_location uuid default null)
returns public.garage_part_requests language plpgsql volatile security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); r public.garage_part_requests; loc uuid; net numeric;
begin
  if t is null then raise exception 'Sign in first'; end if;
  select * into r from public.garage_part_requests where id = p_request and tenant_id = t for update;
  if not found then raise exception 'Part request not found'; end if;
  if r.item_id is null then raise exception 'Pick the item from stock first'; end if;
  if coalesce(p_qty, 0) = 0 then return r; end if;
  net := r.issued_qty - r.returned_qty;
  if p_qty < 0 and -p_qty > net then raise exception 'Only % issued to this job', net; end if;
  loc := coalesce(p_location, r.location_id, (select default_location_id from public.garage_settings where tenant_id = t),
    (select id from public.locations where tenant_id = t and is_active order by created_at limit 1));
  if loc is null then raise exception 'Add a store location first (Inventory → Warehouses)'; end if;
  -- A line already on an invoice had its stock taken by the invoice: only record the hand-over.
  if not exists (select 1 from public.garage_job_lines where id = r.line_id and invoice_id is not null) then
    perform public.stock_move(t, r.item_id, loc, -p_qty, case when p_qty > 0 then 'garage_job_issue' else 'garage_job_return' end, auth.uid());
  end if;
  update public.garage_part_requests set
    issued_qty = issued_qty + greatest(p_qty, 0),
    returned_qty = returned_qty + greatest(-p_qty, 0),
    location_id = loc,
    status = case
      when issued_qty + greatest(p_qty, 0) - returned_qty - greatest(-p_qty, 0) <= 0 and returned_qty + greatest(-p_qty, 0) > 0 then 'returned'
      when issued_qty + greatest(p_qty, 0) >= qty then 'issued' else 'partly_issued' end,
    issued_by = auth.uid(), issued_at = now()
   where id = r.id returning * into r;
  if r.line_id is not null then
    update public.garage_job_lines set issued_qty = (select coalesce(sum(issued_qty - returned_qty), 0) from public.garage_part_requests where line_id = r.line_id)
     where id = r.line_id;
  end if;
  insert into public.garage_job_events (tenant_id, job_id, kind, note) values (t, r.job_id, case when p_qty > 0 then 'part_issued' else 'part_returned' end,
    abs(p_qty)::text || ' × ' || coalesce(r.description, (select name from public.products where id = r.item_id), 'part'));
  return r;
end $$;
revoke all on function public.garage_issue_part(uuid, numeric, uuid) from public, anon;
grant execute on function public.garage_issue_part(uuid, numeric, uuid) to authenticated;

-- Invoices made from a job (one per payer: customer, insurer, fleet). Invoices are normal sales invoices.
create table if not exists public.garage_job_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  job_id uuid not null references public.garage_jobs(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  payer text not null default 'customer',
  is_deposit boolean not null default false,
  created_at timestamptz not null default now(),
  unique (job_id, invoice_id)
);
create index if not exists garage_job_invoices_inv_idx on public.garage_job_invoices (invoice_id);
alter table public.garage_job_invoices enable row level security;
drop policy if exists garage_job_invoices_tenant on public.garage_job_invoices;
create policy garage_job_invoices_tenant on public.garage_job_invoices for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, delete on public.garage_job_invoices to authenticated;

/**
 * Before the invoice is made: parts already issued to the job go back on the shelf (in the books only),
 * because the invoice takes them out of stock again when it is issued. No part is counted twice.
 * p_back = false re-issues them (when the invoice could not be saved).
 */
create or replace function public.garage_parts_to_invoice(p_job uuid, p_lines uuid[], p_back boolean default true)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); r record; n integer := 0;
begin
  if t is null then raise exception 'Sign in first'; end if;
  for r in select pr.* from public.garage_part_requests pr
            where pr.job_id = p_job and pr.tenant_id = t and pr.line_id = any(p_lines) and pr.item_id is not null
              and pr.issued_qty - pr.returned_qty > 0 and pr.location_id is not null loop
    perform public.stock_move(t, r.item_id, r.location_id, case when p_back then 1 else -1 end * (r.issued_qty - r.returned_qty),
      case when p_back then 'garage_to_invoice' else 'garage_job_issue' end, auth.uid());
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.garage_parts_to_invoice(uuid, uuid[], boolean) from public, anon;
grant execute on function public.garage_parts_to_invoice(uuid, uuid[], boolean) to authenticated;

/** Links a saved invoice to the job and its lines. */
create or replace function public.garage_link_invoice(p_job uuid, p_invoice uuid, p_payer text, p_lines uuid[], p_deposit boolean default false)
returns void language plpgsql volatile security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id();
begin
  if t is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.garage_jobs where id = p_job and tenant_id = t) then raise exception 'Job not found'; end if;
  if not exists (select 1 from public.invoices where id = p_invoice and tenant_id = t) then raise exception 'Invoice not found'; end if;
  insert into public.garage_job_invoices (tenant_id, job_id, invoice_id, payer, is_deposit) values (t, p_job, p_invoice, coalesce(p_payer, 'customer'), coalesce(p_deposit, false))
    on conflict (job_id, invoice_id) do nothing;
  update public.garage_job_lines set invoice_id = p_invoice where job_id = p_job and id = any(coalesce(p_lines, '{}'));
  update public.garage_jobs set invoice_id = coalesce(invoice_id, case when coalesce(p_payer, 'customer') = 'customer' and not coalesce(p_deposit, false) then p_invoice end)
   where id = p_job;
  insert into public.garage_job_events (tenant_id, job_id, kind, note)
    values (t, p_job, 'invoice', (select coalesce(invoice_number, '') from public.invoices where id = p_invoice) || ' for ' || coalesce(p_payer, 'customer'));
end $$;
revoke all on function public.garage_link_invoice(uuid, uuid, text, uuid[], boolean) from public, anon;
grant execute on function public.garage_link_invoice(uuid, uuid, text, uuid[], boolean) to authenticated;

/**
 * Gate pass: the car leaves only when every invoice of the job is paid, or a manager approves it on credit.
 * Returns what is still owed. p_credit = true releases on credit (needs invoices.approve or owner).
 */
create or replace function public.garage_release_gate(p_job uuid, p_credit boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); j public.garage_jobs; owed numeric; n integer;
begin
  if t is null then raise exception 'Sign in first'; end if;
  select * into j from public.garage_jobs where id = p_job and tenant_id = t for update;
  if not found then raise exception 'Job not found'; end if;
  if j.status <> 'ready' then raise exception 'Only a car that is ready can leave'; end if;
  select count(*), coalesce(sum(greatest(i.total - coalesce(i.amount_paid, 0), 0)), 0) into n, owed
    from public.garage_job_invoices gi join public.invoices i on i.id = gi.invoice_id
   where gi.job_id = j.id and i.status not in ('void', 'cancelled');
  if n = 0 and j.approved_total > 0 and not p_credit then
    return jsonb_build_object('ok', false, 'owed', j.approved_total, 'reason', 'No invoice yet');
  end if;
  if owed > 0.5 and not p_credit then
    return jsonb_build_object('ok', false, 'owed', owed, 'reason', 'Not fully paid');
  end if;
  if p_credit and owed > 0.5 and not (public.can_manage_shop() or public.has_shop_permission('invoices.approve') or public.has_shop_permission('garage_jobs.approve')) then
    raise exception 'Only a manager can let a car go on credit';
  end if;
  update public.garage_jobs set gate_released_at = now(), gate_released_by = auth.uid(), gate_on_credit = (p_credit and owed > 0.5)
   where id = j.id;
  insert into public.garage_job_events (tenant_id, job_id, kind, note) values (t, j.id, 'gate',
    case when p_credit and owed > 0.5 then 'Released on credit, owing ' || owed::text else 'Released: paid' end);
  return jsonb_build_object('ok', true, 'owed', owed, 'credit', p_credit and owed > 0.5);
end $$;
revoke all on function public.garage_release_gate(uuid, boolean) from public, anon;
grant execute on function public.garage_release_gate(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- inspections

create table if not exists public.garage_inspection_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  kind text not null default 'multi_point' check (kind in ('multi_point', 'pre_purchase', 'ntsa', 'quality_check', 'other')),
  items jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.garage_inspection_templates enable row level security;
drop policy if exists garage_inspection_templates_tenant on public.garage_inspection_templates;
create policy garage_inspection_templates_tenant on public.garage_inspection_templates for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_inspection_templates to authenticated;

create table if not exists public.garage_inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  inspection_no text,
  job_id uuid references public.garage_jobs(id) on delete cascade,
  vehicle_id uuid references public.garage_vehicles(id) on delete set null,
  template_id uuid references public.garage_inspection_templates(id) on delete set null,
  name text,
  kind text,
  results jsonb not null default '[]'::jsonb,
  summary text,
  status text not null default 'open' check (status in ('open', 'done')),
  mileage integer,
  done_by uuid default auth.uid(),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists garage_inspections_job_idx on public.garage_inspections (job_id);
create index if not exists garage_inspections_tenant_idx on public.garage_inspections (tenant_id, created_at desc);
alter table public.garage_inspections enable row level security;
drop policy if exists garage_inspections_tenant on public.garage_inspections;
create policy garage_inspections_tenant on public.garage_inspections for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_inspections to authenticated;

create or replace function public.garage_inspection_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and coalesce(new.inspection_no, '') = '' then new.inspection_no := public.garage_next_no(new.tenant_id, 'inspection', 'INS-'); end if;
  new.updated_at := now();
  if new.status = 'done' and new.done_at is null then new.done_at := now(); end if;
  return new;
end $$;
drop trigger if exists garage_inspection_before on public.garage_inspections;
create trigger garage_inspection_before before insert or update on public.garage_inspections for each row execute function public.garage_inspection_before();

-- ---------------------------------------------------------------- estimates

create table if not exists public.garage_estimates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  job_id uuid not null references public.garage_jobs(id) on delete cascade,
  version integer not null default 1,
  kind text not null default 'initial' check (kind in ('initial', 'extra', 'revision')),
  token text unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status text not null default 'draft' check (status in ('draft', 'sent', 'viewed', 'approved', 'partly_approved', 'declined', 'expired', 'superseded')),
  lines jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  approved_total numeric not null default 0,
  deposit_amount numeric,
  message text,
  expires_at timestamptz,
  sent_at timestamptz,
  sent_via text,
  viewed_at timestamptz,
  responded_at timestamptz,
  responded_via text,
  customer_note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists garage_estimates_job_idx on public.garage_estimates (job_id, version desc);
create index if not exists garage_estimates_tenant_idx on public.garage_estimates (tenant_id, created_at desc);
alter table public.garage_estimates enable row level security;
drop policy if exists garage_estimates_tenant on public.garage_estimates;
create policy garage_estimates_tenant on public.garage_estimates for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_estimates to authenticated;

-- ---------------------------------------------------------------- libraries

create table if not exists public.garage_service_menus (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  make text, model text, engine text,
  labour_hours numeric,
  labour_price numeric not null default 0,
  parts jsonb not null default '[]'::jsonb,
  interval_months integer, interval_km integer,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.garage_service_menus enable row level security;
drop policy if exists garage_service_menus_tenant on public.garage_service_menus;
create policy garage_service_menus_tenant on public.garage_service_menus for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_service_menus to authenticated;

create table if not exists public.garage_job_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  job_type text not null default 'mechanical',
  complaint text,
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.garage_job_templates enable row level security;
drop policy if exists garage_job_templates_tenant on public.garage_job_templates;
create policy garage_job_templates_tenant on public.garage_job_templates for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_job_templates to authenticated;

create table if not exists public.garage_tech_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  make text, model text, engine text, year_from integer, year_to integer,
  category text not null default 'common_fault' check (category in ('torque', 'fluids', 'common_fault', 'procedure', 'wiring', 'other')),
  title text not null,
  body text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists garage_tech_notes_idx on public.garage_tech_notes (tenant_id, make, model);
alter table public.garage_tech_notes enable row level security;
drop policy if exists garage_tech_notes_tenant on public.garage_tech_notes;
create policy garage_tech_notes_tenant on public.garage_tech_notes for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.garage_tech_notes to authenticated;

-- ---------------------------------------------------------------- reminders log

create table if not exists public.garage_reminder_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  due_key text not null,
  vehicle_id uuid references public.garage_vehicles(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  booking_id uuid,
  channel text,
  recipient text,
  status text not null default 'sending',
  detail text,
  created_at timestamptz not null default now(),
  unique (tenant_id, kind, due_key)
);
create index if not exists garage_reminder_log_tenant_idx on public.garage_reminder_log (tenant_id, created_at desc);
alter table public.garage_reminder_log enable row level security;
drop policy if exists garage_reminder_log_tenant on public.garage_reminder_log;
create policy garage_reminder_log_tenant on public.garage_reminder_log for select to authenticated
  using (tenant_id = public.current_user_tenant_id());
grant select on public.garage_reminder_log to authenticated;

-- ---------------------------------------------------------------- reports

/** Workshop figures for a date range, per company (security definer, scoped to the caller's company). */
create or replace function public.garage_report(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); out jsonb;
begin
  if t is null then raise exception 'Sign in first'; end if;
  with jobs as (
    select * from public.garage_jobs where tenant_id = t and created_at >= p_from and created_at < p_to
  ), lines as (
    select l.* from public.garage_job_lines l join jobs j on j.id = l.job_id where l.status <> 'cancelled'
  ), clocks as (
    select tl.* from public.garage_time_logs tl where tl.tenant_id = t and tl.started_at >= p_from and tl.started_at < p_to and tl.ended_at is not null
  ), est as (
    select e.* from public.garage_estimates e where e.tenant_id = t and e.sent_at >= p_from and e.sent_at < p_to
  )
  select jsonb_build_object(
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from jobs group by status) s),
    'by_type', (select coalesce(jsonb_object_agg(job_type, n), '{}'::jsonb) from (select job_type, count(*) n from jobs group by job_type) s),
    'jobs', (select count(*) from jobs),
    'avg_hours_in_shop', (select round(avg(extract(epoch from (coalesce(collected_at, ready_at) - checked_in_at)) / 3600.0)::numeric, 1) from jobs where checked_in_at is not null and coalesce(collected_at, ready_at) is not null),
    'stage_minutes', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (select k, round(sum(v::numeric), 0) v from jobs, jsonb_each_text(stage_minutes) as e(k, v) group by k) s),
    'comebacks', (select count(*) from jobs where comeback_of is not null),
    'comeback_cost', (select coalesce(sum(warranty_cost), 0) from jobs where comeback_of is not null),
    'avg_job_value', (select round(avg(approved_total), 2) from jobs where approved_total > 0),
    'estimates_sent', (select count(*) from est),
    'estimates_approved', (select count(*) from est where status in ('approved', 'partly_approved')),
    'estimate_value_sent', (select coalesce(sum(total), 0) from est),
    'estimate_value_approved', (select coalesce(sum(approved_total), 0) from est),
    'rating_avg', (select round(avg(rating)::numeric, 2) from jobs where rating is not null),
    'ratings', (select count(*) from jobs where rating is not null),
    'bay_use', (select coalesce(jsonb_agg(jsonb_build_object('bay', coalesce(b.name, j.bay, 'No bay'), 'jobs', j.n, 'hours', j.h)), '[]'::jsonb)
                from (select bay_id, bay, count(*) n, round(sum(extract(epoch from (coalesce(collected_at, ready_at, now()) - coalesce(checked_in_at, created_at))) / 3600.0)::numeric, 1) h
                        from jobs group by bay_id, bay) j left join public.garage_bays b on b.id = j.bay_id),
    'mechanics', (select coalesce(jsonb_agg(m), '[]'::jsonb) from (
        select x.mechanic_id,
               coalesce((select display_name from public.profiles p where p.user_id = x.mechanic_id limit 1), 'Staff') as name,
               round(sum(x.sold_hours), 1) sold_hours, round(sum(x.clocked) / 60.0, 1) clocked_hours, round(sum(x.revenue), 2) revenue
          from (
            select unnest(l.mechanic_ids) mechanic_id,
                   coalesce(l.hours, case when l.pricing = 'hourly' then l.qty else 0 end) / greatest(cardinality(l.mechanic_ids), 1) sold_hours,
                   0::numeric clocked,
                   round(l.qty * l.rate * (1 - least(greatest(l.discount, 0), 100) / 100), 2) / greatest(cardinality(l.mechanic_ids), 1) revenue
              from lines l where l.kind = 'labour' and cardinality(l.mechanic_ids) > 0 and l.approved is not false
            union all
            select c.mechanic_id, 0, c.minutes, 0 from clocks c
          ) x group by x.mechanic_id order by 5 desc) m)
  ) into out;
  return out;
end $$;
revoke all on function public.garage_report(timestamptz, timestamptz) from public, anon;
grant execute on function public.garage_report(timestamptz, timestamptz) to authenticated;

/** Labour time guide: how long this garage takes for a job description on a make/model (from its own clocked history). */
create or replace function public.garage_time_guide(p_make text default null, p_model text default null, p_q text default null)
returns table (description text, make text, model text, jobs bigint, avg_hours numeric, avg_price numeric)
language sql stable security definer set search_path = public as $$
  select lower(trim(l.description)), v.make, v.model, count(distinct l.id),
         round(avg(coalesce(tl.mins, 0)) / 60.0, 2), round(avg(l.qty * l.rate), 2)
    from public.garage_job_lines l
    join public.garage_jobs j on j.id = l.job_id
    left join public.garage_vehicles v on v.id = j.vehicle_id
    left join lateral (select sum(minutes) mins from public.garage_time_logs where line_id = l.id) tl on true
   where l.tenant_id = public.current_user_tenant_id() and l.kind = 'labour' and l.status = 'done'
     and (p_make is null or v.make ilike p_make) and (p_model is null or v.model ilike p_model)
     and (p_q is null or l.description ilike '%' || p_q || '%')
   group by 1, 2, 3
   order by 4 desc
   limit 200
$$;
revoke all on function public.garage_time_guide(text, text, text) from public, anon;
grant execute on function public.garage_time_guide(text, text, text) to authenticated;

-- Live updates for the workshop board, job cards and bookings.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['garage_jobs', 'garage_job_lines', 'garage_bookings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
