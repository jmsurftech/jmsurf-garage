-- HRM v2 (Kenya) and My Space (employee self-service):
--   contracts, memos (read receipts), policies (acknowledgement per version), movements (promotion, transfer,
--   pay change, confirmation; applied to the employee when approved), onboarding / offboarding tasks,
--   separations (Employment Act final dues),
--   casual workers (daily rate, M-Pesa), timesheets; staff see and do their own part in My Space.

-- The signed-in user's employee record in their company.
create or replace function public.hr_my_employee_id() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.hr_employees where user_id = auth.uid() and tenant_id = public.current_user_tenant_id() limit 1
$$;
grant execute on function public.hr_my_employee_id() to authenticated;

alter table public.hr_employees add column if not exists self_edit_unlocked boolean not null default false;
alter table public.hr_employees add column if not exists personal_email text;
alter table public.hr_employees add column if not exists postal_address text;
alter table public.hr_employees add column if not exists confirmed_on date;
alter table public.hr_employees add column if not exists leave_days_taken_opening numeric not null default 0;

create table if not exists public.hr_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  contract_no text,
  kind text not null default 'permanent',          -- permanent, fixed_term, probation, casual, internship, consultancy
  start_date date not null default current_date,
  end_date date,
  salary numeric not null default 0,
  notice_days int not null default 30,
  terms text,
  file_url text,
  status text not null default 'active',          -- draft, active, expired, terminated, renewed
  signed_on date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.hr_memos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  body text not null default '',
  audience text not null default 'all',             -- all, department
  department_id uuid references public.hr_departments(id) on delete set null,
  requires_ack boolean not null default false,
  file_url text,
  published_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.hr_memo_reads (
  memo_id uuid not null references public.hr_memos(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  read_at timestamptz not null default now(),
  acked_at timestamptz,
  primary key (memo_id, employee_id)
);

create table if not exists public.hr_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  category text not null default 'General',
  body text not null default '',
  file_url text,
  version int not null default 1,
  requires_ack boolean not null default true,
  status text not null default 'published',          -- draft, published, archived
  effective_date date default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.hr_policy_acks (
  policy_id uuid not null references public.hr_policies(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version int not null,
  acked_at timestamptz not null default now(),
  primary key (policy_id, employee_id, version)
);

create table if not exists public.hr_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  kind text not null,                                -- promotion, transfer, salary_change, demotion, confirmation, redesignation, acting
  effective_date date not null default current_date,
  from_data jsonb not null default '{}'::jsonb,
  to_data jsonb not null default '{}'::jsonb,
  reason text,
  status text not null default 'pending',            -- pending, applied, rejected
  decided_by uuid,
  decided_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.hr_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  kind text not null default 'onboarding',           -- onboarding, offboarding
  title text not null,
  owner text,
  due_date date,
  done_at timestamptz,
  done_by uuid,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.hr_separations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  kind text not null default 'resignation',          -- resignation, termination, redundancy, retirement, end_of_contract, death, desertion
  notice_date date not null default current_date,
  last_day date,
  reason text,
  notice_days int not null default 30,
  notice_served boolean not null default true,
  leave_days_due numeric not null default 0,
  final_dues jsonb not null default '{}'::jsonb,
  status text not null default 'open',               -- open, cleared, paid, closed
  certificate_issued_on date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.hr_casuals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  national_id text,
  kra_pin text,
  phone text,
  mpesa_phone text,
  daily_rate numeric not null default 0,
  skill text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.hr_casual_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  casual_id uuid not null references public.hr_casuals(id) on delete cascade,
  work_date date not null default current_date,
  days numeric not null default 1,
  rate numeric not null default 0,
  amount numeric not null default 0,
  task text,
  paid_on date,
  paid_ref text,
  created_at timestamptz not null default now()
);

create table if not exists public.hr_timesheets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  work_date date not null default current_date,
  project text,
  task text not null default '',
  hours numeric not null default 0,
  billable boolean not null default false,
  note text,
  status text not null default 'submitted',          -- draft, submitted, approved, rejected
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.hr_loans add column if not exists requested_by uuid;
alter table public.hr_loans add column if not exists reason text;
alter table public.hr_loans drop constraint if exists hr_loans_status_check;
alter table public.hr_loans add constraint hr_loans_status_check check (status in ('requested', 'active', 'cleared', 'cancelled', 'rejected'));

-- ── Security ────────────────────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['hr_contracts','hr_memos','hr_memo_reads','hr_policies','hr_policy_acks','hr_movements','hr_tasks',
                           'hr_separations','hr_casuals','hr_casual_days','hr_timesheets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id = public.current_user_tenant_id() and public.hr_can()) with check (tenant_id = public.current_user_tenant_id() and public.hr_can())', t || '_rw', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Staff: their own contracts, movements, tasks and separation.
do $$ declare t text; begin
  foreach t in array array['hr_contracts','hr_movements','hr_tasks','hr_separations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_self', t);
    execute format('create policy %I on public.%I for select to authenticated using (employee_id = public.hr_my_employee_id())', t || '_self', t);
  end loop;
end $$;
-- Everyone in the company reads memos meant for them, published policies and open internal jobs.
drop policy if exists hr_memos_staff on public.hr_memos;
create policy hr_memos_staff on public.hr_memos for select to authenticated using (
  tenant_id = public.current_user_tenant_id() and published_at <= now()
  and (audience = 'all' or department_id = (select department_id from public.hr_employees where id = public.hr_my_employee_id())));
drop policy if exists hr_policies_staff on public.hr_policies;
create policy hr_policies_staff on public.hr_policies for select to authenticated using (tenant_id = public.current_user_tenant_id() and status = 'published');
-- Own read receipts, acknowledgements, internal applications and timesheets.
drop policy if exists hr_memo_reads_self on public.hr_memo_reads;
create policy hr_memo_reads_self on public.hr_memo_reads for all to authenticated using (employee_id = public.hr_my_employee_id())
  with check (employee_id = public.hr_my_employee_id() and tenant_id = public.current_user_tenant_id());
drop policy if exists hr_policy_acks_self on public.hr_policy_acks;
create policy hr_policy_acks_self on public.hr_policy_acks for all to authenticated using (employee_id = public.hr_my_employee_id())
  with check (employee_id = public.hr_my_employee_id() and tenant_id = public.current_user_tenant_id());
drop policy if exists hr_timesheets_self on public.hr_timesheets;
create policy hr_timesheets_self on public.hr_timesheets for select to authenticated using (employee_id = public.hr_my_employee_id());
drop policy if exists hr_timesheets_self_write on public.hr_timesheets;
create policy hr_timesheets_self_write on public.hr_timesheets for insert to authenticated with check (
  employee_id = public.hr_my_employee_id() and tenant_id = public.current_user_tenant_id() and status in ('draft', 'submitted'));
drop policy if exists hr_timesheets_self_update on public.hr_timesheets;
create policy hr_timesheets_self_update on public.hr_timesheets for update to authenticated
  using (employee_id = public.hr_my_employee_id() and status in ('draft', 'submitted', 'rejected'))
  with check (employee_id = public.hr_my_employee_id() and status in ('draft', 'submitted'));
drop policy if exists hr_timesheets_self_delete on public.hr_timesheets;
create policy hr_timesheets_self_delete on public.hr_timesheets for delete to authenticated using (employee_id = public.hr_my_employee_id() and status in ('draft', 'submitted', 'rejected'));
-- Own loans (read) and documents (read and add; never delete).
drop policy if exists hr_loans_self on public.hr_loans;
create policy hr_loans_self on public.hr_loans for select to authenticated using (employee_id = public.hr_my_employee_id());
drop policy if exists hr_documents_self on public.hr_documents;
create policy hr_documents_self on public.hr_documents for select to authenticated using (employee_id = public.hr_my_employee_id());
drop policy if exists hr_documents_self_insert on public.hr_documents;
create policy hr_documents_self_insert on public.hr_documents for insert to authenticated with check (employee_id = public.hr_my_employee_id() and tenant_id = public.current_user_tenant_id());
drop policy if exists hr_loan_repayments_self on public.hr_loan_repayments;
create policy hr_loan_repayments_self on public.hr_loan_repayments for select to authenticated using (employee_id = public.hr_my_employee_id());

-- ── My Space actions ────────────────────────────────────────────────────────
-- Staff update their own details while HR has unlocked them (bio data, contacts, next of kin, bank / M-Pesa).
create or replace function public.hr_update_my_details(p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare e public.hr_employees;
begin
  select * into e from public.hr_employees where id = public.hr_my_employee_id();
  if e.id is null then raise exception 'Your login is not linked to an employee record. Ask HR.'; end if;
  if not e.self_edit_unlocked then raise exception 'Your details are locked. Ask HR to unlock them for editing.'; end if;
  update public.hr_employees set
    phone = coalesce(nullif(trim(p ->> 'phone'), ''), phone),
    personal_email = coalesce(p ->> 'personal_email', personal_email),
    address = coalesce(p ->> 'address', address),
    postal_address = coalesce(p ->> 'postal_address', postal_address),
    marital_status = coalesce(nullif(p ->> 'marital_status', ''), marital_status),
    next_of_kin = coalesce(next_of_kin, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'name', p ->> 'next_of_kin', 'relationship', p ->> 'next_of_kin_relationship', 'phone', p ->> 'next_of_kin_phone')),
    kra_pin = coalesce(nullif(upper(trim(p ->> 'kra_pin')), ''), kra_pin),
    nssf_no = coalesce(nullif(trim(p ->> 'nssf_no'), ''), nssf_no),
    shif_no = coalesce(nullif(trim(p ->> 'shif_no'), ''), shif_no),
    bank_name = coalesce(p ->> 'bank_name', bank_name),
    bank_branch = coalesce(p ->> 'bank_branch', bank_branch),
    bank_account = coalesce(p ->> 'bank_account', bank_account),
    mpesa_phone = coalesce(p ->> 'mpesa_phone', mpesa_phone),
    self_edit_unlocked = false,
    updated_at = now()
  where id = e.id;
end $$;
grant execute on function public.hr_update_my_details(jsonb) to authenticated;

-- A salary advance or loan request from My Space (HR approves it on the Loans page).
create or replace function public.hr_request_loan(p_kind text, p_amount numeric, p_months int, p_reason text) returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid := public.hr_my_employee_id(); nid uuid;
begin
  if eid is null then raise exception 'Your login is not linked to an employee record. Ask HR.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  if exists (select 1 from public.hr_loans where employee_id = eid and status = 'requested') then raise exception 'You already have a request waiting for HR'; end if;
  insert into public.hr_loans (tenant_id, employee_id, kind, principal, monthly_installment, balance, issued_on, status, note, reason, requested_by)
  values (public.current_user_tenant_id(), eid, coalesce(nullif(p_kind, ''), 'advance'), p_amount,
          round(p_amount / greatest(coalesce(p_months, 1), 1), 2), p_amount, current_date, 'requested', null, p_reason, auth.uid())
  returning id into nid;
  return nid;
end $$;
grant execute on function public.hr_request_loan(text, numeric, int, text) to authenticated;

-- Applies an approved movement to the employee (designation, department, branch, manager, pay, type).
create or replace function public.hr_apply_movement(p_id uuid, p_approve boolean) returns void language plpgsql security definer set search_path = public as $$
declare m public.hr_movements; t jsonb;
begin
  select * into m from public.hr_movements where id = p_id and tenant_id = public.current_user_tenant_id();
  if m.id is null then raise exception 'Not found'; end if;
  if not public.hr_can() then raise exception 'Not allowed'; end if;
  if m.status <> 'pending' then raise exception 'Already decided'; end if;
  if not p_approve then
    update public.hr_movements set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_id; return;
  end if;
  t := m.to_data;
  update public.hr_employees set
    designation_id = coalesce(nullif(t ->> 'designation_id', '')::uuid, designation_id),
    department_id = coalesce(nullif(t ->> 'department_id', '')::uuid, department_id),
    location_id = coalesce(nullif(t ->> 'location_id', '')::uuid, location_id),
    manager_id = coalesce(nullif(t ->> 'manager_id', '')::uuid, manager_id),
    basic_salary = coalesce(nullif(t ->> 'basic_salary', '')::numeric, basic_salary),
    house_allowance = coalesce(nullif(t ->> 'house_allowance', '')::numeric, house_allowance),
    employment_type = coalesce(nullif(t ->> 'employment_type', ''), employment_type),
    confirmed_on = case when m.kind = 'confirmation' then m.effective_date else confirmed_on end,
    updated_at = now()
  where id = m.employee_id;
  update public.hr_movements set status = 'applied', decided_by = auth.uid(), decided_at = now() where id = p_id;
end $$;
grant execute on function public.hr_apply_movement(uuid, boolean) to authenticated;

create index if not exists hr_contracts_emp on public.hr_contracts (tenant_id, employee_id);
create index if not exists hr_movements_emp on public.hr_movements (tenant_id, employee_id);
create index if not exists hr_tasks_emp on public.hr_tasks (tenant_id, employee_id);
create index if not exists hr_timesheets_emp on public.hr_timesheets (tenant_id, employee_id, work_date);
create index if not exists hr_casual_days_c on public.hr_casual_days (tenant_id, casual_id, work_date);
