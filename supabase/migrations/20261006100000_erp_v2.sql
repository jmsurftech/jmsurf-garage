-- JMSURF DASH v2 (2026-10-06)
--  * credit notes (style) that can be applied to invoices or refunded
--  * customer approval for website sign-ups, portal MFA and forced password change
--  * CRM campaigns, lead → customer conversion, quotes linked to leads
--  * HRM for a Kenyan employer: employees, departments, leave, attendance,
--    payroll (PAYE, NSSF, SHIF, Housing Levy, NITA), loans, holidays, documents
--  * tenant backups (auto + manual) kept in a private storage bucket
-- Apply as supabase_admin in one transaction.

create or replace function public.can_manage_shop() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'super_admin')
$$;

/** Staff whose role has the given permission switched on (owners and managers always). */
create or replace function public.has_shop_permission(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_shop() or exists (
    select 1 from public.user_roles ur join public.role_permissions rp on rp.role = ur.role::text
     where ur.user_id = auth.uid() and rp.permission = p_perm and rp.allowed)
$$;
grant execute on function public.can_manage_shop(), public.has_shop_permission(text) to authenticated;

-- =====================================================================
-- Credit notes
-- =====================================================================
create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  credit_note_number text,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null default '',
  customer_email text,
  invoice_id uuid references public.invoices(id) on delete set null,
  issue_date date not null default current_date,
  reference text,
  reason text,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  discount numeric not null default 0,
  adjustment numeric not null default 0,
  total numeric not null default 0,
  amount_applied numeric not null default 0,
  amount_refunded numeric not null default 0,
  status text not null default 'open' check (status in ('draft', 'open', 'closed', 'void')),
  refund_method text,
  refund_reference text,
  notes text,
  terms text,
  salesperson_id uuid,
  salesperson_name text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists credit_notes_tenant_idx on public.credit_notes (tenant_id, issue_date desc);
create index if not exists credit_notes_customer_idx on public.credit_notes (customer_id);

create table if not exists public.credit_note_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  credit_note_id uuid not null references public.credit_notes(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric not null check (amount > 0),
  applied_at date not null default current_date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cna_invoice_idx on public.credit_note_applications (invoice_id);
create index if not exists cna_note_idx on public.credit_note_applications (credit_note_id);

alter table public.credit_notes enable row level security;
alter table public.credit_note_applications enable row level security;
do $$ begin
  execute 'drop policy if exists credit_notes_rw on public.credit_notes';
  execute 'drop policy if exists cna_rw on public.credit_note_applications';
end $$;
create policy credit_notes_rw on public.credit_notes for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.has_shop_permission('invoices'))
  with check (tenant_id = public.current_user_tenant_id() and public.has_shop_permission('invoices'));
create policy cna_rw on public.credit_note_applications for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.has_shop_permission('invoices'))
  with check (tenant_id = public.current_user_tenant_id() and public.has_shop_permission('invoices'));
grant select, insert, update, delete on public.credit_notes, public.credit_note_applications to authenticated;

-- Invoices count credit applied like a payment.
create or replace function public.invoice_refresh_paid(p_invoice uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare paid numeric; inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found then return; end if;
  select coalesce((select sum(amount) from public.payment_allocations where invoice_id = p_invoice), 0)
       + coalesce((select sum(a.amount) from public.credit_note_applications a join public.credit_notes c on c.id = a.credit_note_id
                    where a.invoice_id = p_invoice and c.status <> 'void'), 0)
    into paid;
  update public.invoices set
    amount_paid = paid,
    paid_at = case when paid >= inv.total - 0.005 and inv.total > 0 then coalesce(inv.paid_at, now()) else null end,
    status = case
      when inv.status in ('draft', 'void') then inv.status
      when paid >= inv.total - 0.005 and inv.total > 0 then 'paid'
      when paid > 0 then 'partially_paid'
      when inv.status in ('paid', 'partially_paid') then 'sent'
      else inv.status end,
    updated_at = now()
  where id = p_invoice;
end $function$;

create or replace function public.credit_note_refresh(p_note uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n public.credit_notes; applied numeric;
begin
  select * into n from public.credit_notes where id = p_note;
  if not found then return; end if;
  select coalesce(sum(amount), 0) into applied from public.credit_note_applications where credit_note_id = p_note;
  update public.credit_notes set amount_applied = applied,
    status = case when n.status in ('draft', 'void') then n.status
                  when applied + n.amount_refunded >= n.total - 0.005 then 'closed' else 'open' end,
    updated_at = now()
  where id = p_note;
end $$;

create or replace function public.credit_note_applications_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare src text; cust uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public.invoice_refresh_paid(new.invoice_id); perform public.credit_note_refresh(new.credit_note_id); end if;
  if tg_op in ('DELETE', 'UPDATE') then perform public.invoice_refresh_paid(old.invoice_id); perform public.credit_note_refresh(old.credit_note_id); end if;
  -- Till credit sales keep the customer's running balance too.
  select source, customer_id into src, cust from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if src = 'pos' and cust is not null then
    if tg_op = 'INSERT' then update public.customers set balance = greatest(coalesce(balance, 0) - new.amount, 0) where id = cust;
    elsif tg_op = 'DELETE' then update public.customers set balance = coalesce(balance, 0) + old.amount where id = cust;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists credit_note_applications_sync on public.credit_note_applications;
create trigger credit_note_applications_sync after insert or update or delete on public.credit_note_applications
  for each row execute function public.credit_note_applications_sync();

/** Apply part of a credit note to an invoice of the same customer. */
create or replace function public.apply_credit_note(p_note uuid, p_invoice uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare n public.credit_notes; i public.invoices; avail numeric;
begin
  select * into n from public.credit_notes where id = p_note and tenant_id = public.current_user_tenant_id() for update;
  if not found then raise exception 'Credit note not found'; end if;
  if not public.has_shop_permission('invoices') then raise exception 'Not allowed'; end if;
  if n.status in ('draft', 'void') then raise exception 'Open the credit note first'; end if;
  select * into i from public.invoices where id = p_invoice and tenant_id = n.tenant_id;
  if not found then raise exception 'Invoice not found'; end if;
  if i.status in ('draft', 'void') then raise exception 'That invoice is draft or void'; end if;
  if n.customer_id is not null and i.customer_id is distinct from n.customer_id then raise exception 'The invoice belongs to another customer'; end if;
  avail := n.total - n.amount_applied - n.amount_refunded;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount'; end if;
  if p_amount > avail + 0.005 then raise exception 'Only % is left on this credit note', round(avail, 2); end if;
  if p_amount > (i.total - i.amount_paid) + 0.005 then raise exception 'The invoice only owes %', round(i.total - i.amount_paid, 2); end if;
  insert into public.credit_note_applications (tenant_id, credit_note_id, invoice_id, amount) values (n.tenant_id, p_note, p_invoice, p_amount);
end $$;
grant execute on function public.apply_credit_note(uuid, uuid, numeric) to authenticated;

/** Record a cash/M-Pesa/bank refund out of a credit note. */
create or replace function public.refund_credit_note(p_note uuid, p_amount numeric, p_method text, p_reference text) returns void
language plpgsql security definer set search_path = public as $$
declare n public.credit_notes; avail numeric;
begin
  select * into n from public.credit_notes where id = p_note and tenant_id = public.current_user_tenant_id() for update;
  if not found then raise exception 'Credit note not found'; end if;
  if not public.has_shop_permission('invoices') then raise exception 'Not allowed'; end if;
  avail := n.total - n.amount_applied - n.amount_refunded;
  if p_amount is null or p_amount <= 0 or p_amount > avail + 0.005 then raise exception 'Refund between 0 and %', round(avail, 2); end if;
  update public.credit_notes set amount_refunded = amount_refunded + p_amount, refund_method = p_method, refund_reference = p_reference, updated_at = now() where id = p_note;
  perform public.credit_note_refresh(p_note);
end $$;
grant execute on function public.refund_credit_note(uuid, numeric, text, text) to authenticated;

-- Receivables in the customer summary are net of open credit.
create or replace view public.customer_summary with (security_invoker = true) as
  select c.id as customer_id, c.tenant_id,
         coalesce(t.total_purchases, 0) as total_purchases,
         coalesce(t.purchase_count, 0) as purchase_count,
         t.last_purchase_at,
         coalesce(d.receivables, 0) as receivables,
         coalesce(d.overdue, 0) as overdue,
         coalesce(cr.unused_credit, 0) as unused_credit
    from public.customers c
    left join lateral (
      select sum(x.total) filter (where x.status = 'completed') as total_purchases,
             count(*) filter (where x.status = 'completed') as purchase_count,
             max(x.created_at) filter (where x.status = 'completed') as last_purchase_at
        from public.transactions x where x.customer_id = c.id
    ) t on true
    left join lateral (
      select sum(i.total - i.amount_paid) as receivables,
             sum(i.total - i.amount_paid) filter (where i.due_date < current_date) as overdue
        from public.invoices i
       where i.customer_id = c.id and i.status not in ('draft', 'void', 'paid') and i.total - i.amount_paid > 0.005
    ) d on true
    left join lateral (
      select sum(n.total - n.amount_applied - n.amount_refunded) as unused_credit
        from public.credit_notes n where n.customer_id = c.id and n.status = 'open'
    ) cr on true;
grant select on public.customer_summary to authenticated;

-- =====================================================================
-- Customers: approval of website sign-ups, portal security
-- =====================================================================
alter table public.customers
  add column if not exists approval_status text not null default 'approved',
  add column if not exists info_request text,
  add column if not exists info_requested_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid;
do $$ begin
  alter table public.customers add constraint customers_approval_status_check check (approval_status in ('approved', 'pending', 'info_requested', 'rejected'));
exception when duplicate_object then null; end $$;

alter table public.customer_accounts
  add column if not exists totp_secret text,
  add column if not exists mfa_enabled boolean not null default false,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists mfa_pending text;

alter table public.quotes add column if not exists lead_id uuid;

-- =====================================================================
-- CRM: campaigns and lead conversion
-- =====================================================================
create table if not exists public.crm_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  channel text not null default 'sms',
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'cancelled')),
  start_date date,
  end_date date,
  budget numeric not null default 0,
  actual_cost numeric not null default 0,
  expected_revenue numeric not null default 0,
  target_audience text,
  description text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_campaigns enable row level security;
drop policy if exists crm_campaigns_rw on public.crm_campaigns;
create policy crm_campaigns_rw on public.crm_campaigns for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.crm_campaigns to authenticated;

/** Turns a lead into a customer (found by phone/email or created) and an opportunity. */
create or replace function public.crm_convert_lead(p_lead uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare l public.crm_leads; cid uuid;
begin
  select * into l from public.crm_leads where id = p_lead and tenant_id = public.current_user_tenant_id() for update;
  if not found then raise exception 'Lead not found'; end if;
  cid := l.customer_id;
  if cid is null and coalesce(nullif(l.mobile, ''), nullif(l.phone, '')) is not null then
    cid := public.customer_find_or_create_for(l.tenant_id, coalesce(nullif(l.mobile, ''), l.phone), coalesce(nullif(l.partner_name, ''), nullif(l.contact_name, ''), l.name), nullif(l.email, ''), 'crm');
  end if;
  if cid is null and nullif(l.email, '') is not null then
    select id into cid from public.customers where tenant_id = l.tenant_id and lower(email) = lower(l.email) limit 1;
  end if;
  if cid is null then
    insert into public.customers (tenant_id, name, email, source, company_name, customer_type)
    values (l.tenant_id, coalesce(nullif(l.partner_name, ''), nullif(l.contact_name, ''), l.name), nullif(l.email, ''), 'crm', nullif(l.partner_name, ''), case when nullif(l.partner_name, '') is not null then 'business' else 'individual' end)
    returning id into cid;
  end if;
  update public.customers set address = coalesce(address, nullif(concat_ws(', ', nullif(l.street, ''), nullif(l.city, '')), '')),
    company_name = coalesce(company_name, nullif(l.partner_name, '')), salesperson_id = coalesce(salesperson_id, l.salesperson_id)
   where id = cid;
  update public.crm_leads set customer_id = cid, type = 'opportunity', date_conversion = coalesce(date_conversion, now()), updated_at = now() where id = p_lead;
  return cid;
end $$;
grant execute on function public.crm_convert_lead(uuid) to authenticated;

-- =====================================================================
-- HRM (Kenya)
-- =====================================================================
create or replace function public.hr_can() returns boolean
language sql stable security definer set search_path = public as $$ select public.has_shop_permission('hrm') $$;
grant execute on function public.hr_can() to authenticated;

create table if not exists public.hr_departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  head_employee_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create table if not exists public.hr_designations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  department_id uuid references public.hr_departments(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create table if not exists public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid,
  employee_no text,
  first_name text not null,
  last_name text not null default '',
  other_names text,
  gender text,
  date_of_birth date,
  marital_status text,
  national_id text,
  kra_pin text,
  nssf_no text,
  shif_no text,
  phone text,
  email text,
  address text,
  photo_url text,
  next_of_kin jsonb not null default '{}'::jsonb,
  department_id uuid references public.hr_departments(id) on delete set null,
  designation_id uuid references public.hr_designations(id) on delete set null,
  manager_id uuid references public.hr_employees(id) on delete set null,
  employment_type text not null default 'permanent',
  hire_date date not null default current_date,
  probation_end date,
  contract_end date,
  status text not null default 'active' check (status in ('active', 'probation', 'on_leave', 'suspended', 'terminated', 'resigned')),
  exit_date date,
  exit_reason text,
  basic_salary numeric not null default 0,
  house_allowance numeric not null default 0,
  payment_method text not null default 'bank',
  bank_name text,
  bank_branch text,
  bank_account text,
  mpesa_phone text,
  disability_exempt boolean not null default false,
  insurance_premium numeric not null default 0,
  pension_contribution numeric not null default 0,
  mortgage_interest numeric not null default 0,
  helb_deduction numeric not null default 0,
  is_sales_rep boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hr_employees_no_key on public.hr_employees (tenant_id, employee_no) where employee_no is not null;
create unique index if not exists hr_employees_user_key on public.hr_employees (tenant_id, user_id) where user_id is not null;

create table if not exists public.hr_pay_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  kind text not null check (kind in ('allowance', 'deduction', 'benefit')),
  name text not null,
  amount numeric not null default 0,
  taxable boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.hr_leave_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  days_per_year numeric not null default 0,
  paid boolean not null default true,
  carry_forward_max numeric not null default 0,
  gender text,
  requires_document boolean not null default false,
  active boolean not null default true,
  unique (tenant_id, name)
);
create table if not exists public.hr_leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  leave_type_id uuid references public.hr_leave_types(id) on delete set null,
  start_date date not null,
  end_date date not null,
  days numeric not null default 1,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create table if not exists public.hr_attendance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  date date not null,
  status text not null default 'present' check (status in ('present', 'late', 'half_day', 'absent', 'leave', 'off', 'holiday')),
  clock_in time,
  clock_out time,
  hours numeric not null default 0,
  overtime_hours numeric not null default 0,
  note text,
  created_at timestamptz not null default now(),
  unique (employee_id, date)
);
create table if not exists public.hr_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period text not null,
  period_start date not null,
  period_end date not null,
  pay_date date,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  totals jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid default auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, period)
);
create table if not exists public.hr_payslips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.hr_payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  employee_name text not null default '',
  basic numeric not null default 0,
  gross numeric not null default 0,
  taxable_pay numeric not null default 0,
  nssf numeric not null default 0,
  shif numeric not null default 0,
  housing_levy numeric not null default 0,
  paye numeric not null default 0,
  loan_deductions numeric not null default 0,
  other_deductions numeric not null default 0,
  net_pay numeric not null default 0,
  employer_nssf numeric not null default 0,
  employer_housing numeric not null default 0,
  nita numeric not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create table if not exists public.hr_loans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  kind text not null default 'advance' check (kind in ('advance', 'loan')),
  principal numeric not null check (principal > 0),
  monthly_installment numeric not null default 0,
  balance numeric not null default 0,
  issued_on date not null default current_date,
  status text not null default 'active' check (status in ('active', 'cleared', 'cancelled')),
  note text,
  created_at timestamptz not null default now()
);
create table if not exists public.hr_holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  date date not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, date)
);
create table if not exists public.hr_disciplinary (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  date date not null default current_date,
  kind text not null,
  description text,
  action text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.hr_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  name text not null,
  kind text,
  url text,
  expires_on date,
  created_at timestamptz not null default now()
);
create table if not exists public.hr_appraisals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  period text not null,
  score numeric,
  reviewer text,
  strengths text,
  improvements text,
  goals text,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['hr_departments','hr_designations','hr_employees','hr_pay_items','hr_leave_types','hr_leave_requests','hr_attendance','hr_payroll_runs','hr_payslips','hr_loans','hr_holidays','hr_disciplinary','hr_documents','hr_appraisals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id = public.current_user_tenant_id() and public.hr_can()) with check (tenant_id = public.current_user_tenant_id() and public.hr_can())', t || '_rw', t);
    execute format('drop policy if exists %I on public.%I', t || '_tid', t);
    execute format('create index if not exists %I on public.%I (tenant_id)', t || '_tenant_idx', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Staff can see their own employee record, payslips and leave, and ask for leave.
drop policy if exists hr_employees_self on public.hr_employees;
create policy hr_employees_self on public.hr_employees for select to authenticated using (user_id = auth.uid());
drop policy if exists hr_payslips_self on public.hr_payslips;
create policy hr_payslips_self on public.hr_payslips for select to authenticated
  using (employee_id in (select id from public.hr_employees where user_id = auth.uid()));
drop policy if exists hr_leave_self on public.hr_leave_requests;
create policy hr_leave_self on public.hr_leave_requests for select to authenticated
  using (employee_id in (select id from public.hr_employees where user_id = auth.uid()));
drop policy if exists hr_leave_self_insert on public.hr_leave_requests;
create policy hr_leave_self_insert on public.hr_leave_requests for insert to authenticated
  with check (status = 'pending' and tenant_id = public.current_user_tenant_id() and employee_id in (select id from public.hr_employees where user_id = auth.uid()));
drop policy if exists hr_leave_types_read on public.hr_leave_types;
create policy hr_leave_types_read on public.hr_leave_types for select to authenticated using (tenant_id = public.current_user_tenant_id());

/** Next employee number, e.g. FT-EMP-0007. */
create or replace function public.hr_next_employee_no() returns text
language plpgsql security definer set search_path = public as $$
begin
  return public.next_doc_number('employee');
end $$;
grant execute on function public.hr_next_employee_no() to authenticated;

-- Default leave types under the Employment Act 2007 and Kenya's public holidays.
insert into public.hr_leave_types (tenant_id, name, days_per_year, paid, carry_forward_max, gender, requires_document)
select t.id, v.name, v.days, v.paid, v.cf, v.gender, v.doc
  from public.tenants t
 cross join (values ('Annual leave', 21, true, 10, null, false), ('Sick leave', 14, true, 0, null, true),
                    ('Maternity leave', 90, true, 0, 'female', true), ('Paternity leave', 14, true, 0, 'male', false),
                    ('Compassionate leave', 5, true, 0, null, false), ('Unpaid leave', 0, false, 0, null, false),
                    ('Study leave', 10, true, 0, null, true)) as v(name, days, paid, cf, gender, doc)
 where t.deleted_at is null
on conflict (tenant_id, name) do nothing;

insert into public.hr_holidays (tenant_id, date, name)
select t.id, v.d::date, v.n from public.tenants t cross join (values
  ('2026-01-01', 'New Year''s Day'), ('2026-04-03', 'Good Friday'), ('2026-04-06', 'Easter Monday'),
  ('2026-05-01', 'Labour Day'), ('2026-06-01', 'Madaraka Day'), ('2026-10-10', 'Mazingira Day'),
  ('2026-10-20', 'Mashujaa Day'), ('2026-12-12', 'Jamhuri Day'), ('2026-12-25', 'Christmas Day'), ('2026-12-26', 'Boxing Day'),
  ('2027-01-01', 'New Year''s Day'), ('2027-03-26', 'Good Friday'), ('2027-03-29', 'Easter Monday'),
  ('2027-05-01', 'Labour Day'), ('2027-06-01', 'Madaraka Day'), ('2027-10-10', 'Mazingira Day'),
  ('2027-10-20', 'Mashujaa Day'), ('2027-12-12', 'Jamhuri Day'), ('2027-12-25', 'Christmas Day'), ('2027-12-26', 'Boxing Day')) as v(d, n)
 where t.deleted_at is null
on conflict (tenant_id, date) do nothing;

insert into public.hr_departments (tenant_id, name)
select t.id, v.n from public.tenants t cross join (values ('Management'), ('Sales'), ('Shop floor'), ('Stores & logistics'), ('Grooming & care'), ('Finance & admin')) v(n)
 where t.deleted_at is null on conflict (tenant_id, name) do nothing;

create or replace function public.doc_prefix_default(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'quote' then 'QT-' when 'invoice' then 'INV-' when 'payment' then 'PR-' when 'receipt' then 'SR-'
    when 'credit_note' then 'CN-' when 'po' then 'PO-' when 'bill' then 'BILL-' when 'requisition' then 'REQ-'
    when 'delivery_note' then 'DN-' when 'lead' then 'LD-' when 'web_order' then 'WEB-' when 'employee' then 'EMP-'
    when 'payroll' then 'PAY-' else upper(left(p_kind, 3)) || '-' end
$$;

-- =====================================================================
-- Backups
-- =====================================================================
create table if not exists public.tenant_backups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null default 'manual' check (kind in ('auto', 'manual')),
  path text,
  size_bytes bigint not null default 0,
  tables jsonb not null default '{}'::jsonb,
  status text not null default 'ok',
  error text,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.tenant_backups enable row level security;
drop policy if exists tenant_backups_read on public.tenant_backups;
create policy tenant_backups_read on public.tenant_backups for select to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')));
grant select on public.tenant_backups to authenticated;
insert into storage.buckets (id, name, public) values ('tenant-backups', 'tenant-backups', false) on conflict (id) do nothing;

-- Realtime for the tables the customer portal and ERP watch.
do $$
declare t text;
begin
  foreach t in array array['credit_notes','credit_note_applications','hr_leave_requests','crm_campaigns'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when others then null; end;
  end loop;
end $$;
