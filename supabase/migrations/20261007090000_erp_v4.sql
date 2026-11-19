-- ERP v4 (2026-10-05)
--  * Inventory adjustments (style): quantity or value, draft → adjusted.
--  * Customer reminders: recurring, pet return visits, custom; channels.
--  * CRM deals.
--  * Calendar events.
--  * Attendance: working hours from settings, late minutes, early-leave reason.
--  * Payslips: sent by email/SMS log; loan repayment history.
--  * Expenses: vendor, payment method, reference, tax, receipt, notes.

-- ---------------------------------------------------------------- numbering
create or replace function public.doc_prefix_default(p_kind text)
 returns text language sql immutable as $$
  select case p_kind
    when 'quote' then 'QT-' when 'invoice' then 'INV-' when 'payment' then 'PR-' when 'receipt' then 'SR-'
    when 'credit_note' then 'CN-' when 'po' then 'PO-' when 'bill' then 'BILL-' when 'requisition' then 'REQ-'
    when 'delivery_note' then 'DN-' when 'packing_list' then 'PL-' when 'lead' then 'LD-' when 'web_order' then 'WEB-' when 'employee' then 'EMP-'
    when 'payroll' then 'PAY-' when 'purchase_receive' then 'GRN-' when 'expense' then 'EXP-' when 'supplier_payment' then 'SP-'
    when 'adjustment' then 'ADJ-' when 'deal' then 'DEAL-' else upper(left(p_kind, 3)) || '-' end
$$;

-- ---------------------------------------------------------- inventory adjustments
create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  adjustment_number text,
  mode text not null default 'quantity' check (mode in ('quantity', 'value')),
  reference text,
  adjustment_date date not null default current_date,
  account text not null default 'Cost of Goods Sold',
  reason text not null,
  location_id uuid references public.locations(id) on delete set null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'adjusted')),
  lines jsonb not null default '[]'::jsonb,
  value_change numeric not null default 0,
  document_id uuid,
  created_by uuid default auth.uid(),
  created_by_name text,
  adjusted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inventory_adjustments_tenant_idx on public.inventory_adjustments (tenant_id, adjustment_date desc);
alter table public.inventory_adjustments enable row level security;
drop policy if exists inventory_adjustments_rw on public.inventory_adjustments;
create policy inventory_adjustments_rw on public.inventory_adjustments for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());

create or replace function public._adjustment_number() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.adjustment_number is null or new.adjustment_number = '' then
    new.adjustment_number := public.next_doc_number('adjustment', new.tenant_id);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists inventory_adjustments_number on public.inventory_adjustments;
create trigger inventory_adjustments_number before insert or update on public.inventory_adjustments
  for each row execute function public._adjustment_number();

/** Applies a draft adjustment: quantity mode moves stock by each line's "adjusted" amount at the
    adjustment's branch; value mode re-prices the item so stock on hand is worth the new value. */
create or replace function public.apply_inventory_adjustment(p_id uuid)
 returns public.inventory_adjustments language plpgsql security definer set search_path = public as $$
declare
  a public.inventory_adjustments;
  l jsonb;
  v_loc uuid;
  v_before numeric;
  v_after numeric;
  v_delta numeric;
  v_cost numeric;
  v_stock numeric;
  v_total numeric := 0;
begin
  select * into a from public.inventory_adjustments where id = p_id for update;
  if not found or a.tenant_id <> public.current_user_tenant_id() then raise exception 'Adjustment not found'; end if;
  if a.status <> 'draft' then raise exception 'This adjustment was already applied'; end if;
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role::text in ('admin', 'manager', 'stock_manager', 'super_admin')) then
    raise exception 'Only owners, managers and stock managers can adjust stock';
  end if;
  v_loc := coalesce(a.location_id, (select id from public.locations where tenant_id = a.tenant_id order by is_main desc, created_at limit 1));
  for l in select * from jsonb_array_elements(a.lines) loop
    if not exists (select 1 from public.products where id = (l->>'product_id')::uuid and tenant_id = a.tenant_id) then
      raise exception 'An item on this adjustment is not in your catalogue';
    end if;
    select coalesce(cost_price, 0), coalesce(stock, 0) into v_cost, v_stock from public.products where id = (l->>'product_id')::uuid;
    if a.mode = 'quantity' then
      v_delta := coalesce((l->>'qty_adjusted')::numeric, 0);
      if v_delta = 0 then continue; end if;
      insert into public.product_stocks (product_id, location_id, stock)
        select (l->>'product_id')::uuid, v_loc,
          case when exists (select 1 from public.product_stocks where product_id = (l->>'product_id')::uuid) then 0 else greatest(0, v_stock) end
        on conflict (product_id, location_id) do nothing;
      select stock into v_before from public.product_stocks where product_id = (l->>'product_id')::uuid and location_id = v_loc for update;
      v_after := v_before + v_delta;
      if v_after < 0 then raise exception '% would go below zero (on hand %)', coalesce(l->>'name', 'An item'), v_before; end if;
      update public.product_stocks set stock = v_after where product_id = (l->>'product_id')::uuid and location_id = v_loc;
      insert into public.stock_adjustments (product_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
        values ((l->>'product_id')::uuid, v_loc, v_delta, v_before, v_after, left('adjustment ' || coalesce(a.adjustment_number, '') || ': ' || a.reason, 200), auth.uid());
      v_total := v_total + v_delta * v_cost;
    else
      if v_stock > 0 and (l->>'new_value') is not null then
        update public.products set cost_price = round(((l->>'new_value')::numeric / v_stock)::numeric, 2) where id = (l->>'product_id')::uuid;
        v_total := v_total + (l->>'new_value')::numeric - v_stock * v_cost;
      end if;
    end if;
  end loop;
  update public.inventory_adjustments set status = 'adjusted', adjusted_at = now(), value_change = round(v_total, 2) where id = p_id returning * into a;
  return a;
end $$;
revoke execute on function public.apply_inventory_adjustment(uuid) from public, anon;
grant execute on function public.apply_inventory_adjustment(uuid) to authenticated;

-- ---------------------------------------------------------- reminders
alter table public.customer_reminders
  add column if not exists repeat_every integer,
  add column if not exists repeat_unit text,
  add column if not exists repeat_until date,
  add column if not exists channels jsonb not null default '{"sms": true, "email": true}'::jsonb,
  add column if not exists note text,
  add column if not exists parent_id uuid;
do $$ begin
  alter table public.customer_reminders add constraint customer_reminders_repeat_unit_check check (repeat_unit is null or repeat_unit in ('day', 'week', 'month', 'year'));
exception when duplicate_object then null; end $$;
alter table public.customer_pets add column if not exists next_visit date;

-- ---------------------------------------------------------- CRM deals
create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  deal_number text,
  name text not null,
  customer_id uuid references public.customers(id) on delete set null,
  account_name text,
  contact_name text,
  phone text,
  email text,
  amount numeric not null default 0,
  stage text not null default 'qualification',
  probability integer not null default 10,
  closing_date date,
  owner_id uuid,
  source text,
  lead_id uuid references public.crm_leads(id) on delete set null,
  quote_id uuid,
  next_step text,
  description text,
  lost_reason text,
  closed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_deals_tenant_idx on public.crm_deals (tenant_id, stage);
alter table public.crm_deals enable row level security;
drop policy if exists crm_deals_rw on public.crm_deals;
create policy crm_deals_rw on public.crm_deals for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
create or replace function public._deal_number() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deal_number is null or new.deal_number = '' then new.deal_number := public.next_doc_number('deal', new.tenant_id); end if;
  new.updated_at := now();
  if new.stage in ('won', 'lost') and new.closed_at is null then new.closed_at := now(); end if;
  if new.stage not in ('won', 'lost') then new.closed_at := null; end if;
  return new;
end $$;
drop trigger if exists crm_deals_number on public.crm_deals;
create trigger crm_deals_number before insert or update on public.crm_deals for each row execute function public._deal_number();

-- ---------------------------------------------------------- calendar
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  color text,
  kind text not null default 'event',
  location text,
  customer_id uuid references public.customers(id) on delete set null,
  pet_id uuid references public.customer_pets(id) on delete set null,
  attendees uuid[] not null default '{}',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists calendar_events_tenant_idx on public.calendar_events (tenant_id, start_at);
alter table public.calendar_events enable row level security;
drop policy if exists calendar_events_rw on public.calendar_events;
create policy calendar_events_rw on public.calendar_events for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());

-- ---------------------------------------------------------- attendance
alter table public.hr_attendance
  add column if not exists late_minutes integer not null default 0,
  add column if not exists left_early boolean not null default false,
  add column if not exists early_leave_reason text,
  add column if not exists clock_in_at timestamptz,
  add column if not exists clock_out_at timestamptz;

drop function if exists public.hr_clock(text);
/** Staff clock themselves in and out. Working hours come from System → HRM (erp_settings.hr):
    work_start, work_end, grace_minutes, workdays (0 = Sunday … 6 = Saturday). */
create or replace function public.hr_clock(p_action text, p_reason text default null)
 returns public.hr_attendance language plpgsql security definer set search_path = public as $$
declare
  e public.hr_employees;
  cfg jsonb;
  d date := (now() at time zone 'Africa/Nairobi')::date;
  t time := date_trunc('minute', (now() at time zone 'Africa/Nairobi'))::time;
  w_start time; w_end time; grace int; days jsonb;
  r public.hr_attendance;
  late int;
begin
  select * into e from public.hr_employees where user_id = auth.uid() and status not in ('terminated', 'resigned') limit 1;
  if not found then raise exception 'Your login is not linked to an employee record. Ask HR to link it.'; end if;
  select coalesce(erp_settings->'hr', '{}'::jsonb) into cfg from public.business_settings where tenant_id = e.tenant_id limit 1;
  cfg := coalesce(cfg, '{}'::jsonb);
  w_start := coalesce(nullif(cfg->>'work_start', ''), '08:00')::time;
  w_end := coalesce(nullif(cfg->>'work_end', ''), '17:00')::time;
  grace := coalesce((cfg->>'grace_minutes')::int, 15);
  days := coalesce(cfg->'workdays', '[1,2,3,4,5,6]'::jsonb);
  if p_action = 'in' then
    if not (days @> to_jsonb(extract(dow from d)::int)) then raise exception 'Today is not a working day'; end if;
    if t < w_start - interval '2 hours' then raise exception 'Clock-in opens 2 hours before work starts (%).', to_char(w_start, 'HH24:MI'); end if;
    if t >= w_end then raise exception 'Working hours ended at %. Ask HR to record your day.', to_char(w_end, 'HH24:MI'); end if;
    late := greatest(0, (extract(epoch from (t - w_start)) / 60)::int - grace);
    insert into public.hr_attendance (tenant_id, employee_id, date, status, clock_in, clock_in_at, late_minutes)
    values (e.tenant_id, e.id, d, case when late > 0 then 'late' else 'present' end, t, now(), case when late > 0 then late + grace else 0 end)
    on conflict (employee_id, date) do update set
      clock_in = coalesce(public.hr_attendance.clock_in, excluded.clock_in),
      clock_in_at = coalesce(public.hr_attendance.clock_in_at, excluded.clock_in_at),
      late_minutes = case when public.hr_attendance.clock_in is null then excluded.late_minutes else public.hr_attendance.late_minutes end,
      status = case when public.hr_attendance.status in ('absent', 'off') then excluded.status else public.hr_attendance.status end
    returning * into r;
  else
    select * into r from public.hr_attendance where employee_id = e.id and date = d;
    if not found or r.clock_in is null then raise exception 'Clock in first'; end if;
    if t < w_end and coalesce(trim(p_reason), '') = '' then raise exception 'EARLY: Work ends at %. Give a reason for leaving early.', to_char(w_end, 'HH24:MI'); end if;
    update public.hr_attendance set clock_out = t, clock_out_at = now(),
      hours = round((extract(epoch from (t - clock_in)) / 3600.0)::numeric, 2),
      overtime_hours = greatest(0, round((extract(epoch from (t - greatest(w_end, clock_in))) / 3600.0)::numeric, 2)),
      left_early = t < w_end,
      early_leave_reason = case when t < w_end then trim(p_reason) else null end,
      status = case when t < w_end and status = 'present' and extract(epoch from (t - clock_in)) / 3600.0 < 4 then 'half_day' else status end
    where id = r.id returning * into r;
  end if;
  return r;
end $$;
revoke execute on function public.hr_clock(text, text) from public, anon;
grant execute on function public.hr_clock(text, text) to authenticated;

-- ---------------------------------------------------------- payroll
alter table public.hr_payslips
  add column if not exists sent_email_at timestamptz,
  add column if not exists sent_sms_at timestamptz,
  add column if not exists send_log jsonb not null default '{}'::jsonb;
create table if not exists public.hr_loan_repayments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  loan_id uuid not null references public.hr_loans(id) on delete cascade,
  employee_id uuid references public.hr_employees(id) on delete cascade,
  run_id uuid references public.hr_payroll_runs(id) on delete set null,
  payslip_id uuid references public.hr_payslips(id) on delete set null,
  amount numeric not null,
  balance_after numeric,
  paid_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists hr_loan_repayments_loan_idx on public.hr_loan_repayments (loan_id);
alter table public.hr_loan_repayments enable row level security;
drop policy if exists hr_loan_repayments_rw on public.hr_loan_repayments;
create policy hr_loan_repayments_rw on public.hr_loan_repayments for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.hr_can()) with check (tenant_id = public.current_user_tenant_id() and public.hr_can());
drop policy if exists hr_loan_repayments_self on public.hr_loan_repayments;
create policy hr_loan_repayments_self on public.hr_loan_repayments for select to authenticated
  using (employee_id in (select id from public.hr_employees where user_id = auth.uid()));

-- ---------------------------------------------------------- expenses
alter table public.expenses
  add column if not exists expense_number text,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists vendor_name text,
  add column if not exists payment_method text,
  add column if not exists paid_through text,
  add column if not exists reference text,
  add column if not exists tax_amount numeric not null default 0,
  add column if not exists notes text,
  add column if not exists document_id uuid,
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists employee_id uuid references public.hr_employees(id) on delete set null,
  add column if not exists created_by_name text,
  add column if not exists updated_at timestamptz default now();
create or replace function public._expense_number() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.expense_number is null or new.expense_number = '' then new.expense_number := public.next_doc_number('expense', new.tenant_id); end if;
  return new;
end $$;
drop trigger if exists expenses_number on public.expenses;
create trigger expenses_number before insert on public.expenses for each row execute function public._expense_number();
update public.expenses x set expense_number = public.next_doc_number('expense', x.tenant_id) where expense_number is null;

notify pgrst, 'reload schema';
revoke all on public.inventory_adjustments, public.crm_deals, public.calendar_events, public.hr_loan_repayments from anon;
