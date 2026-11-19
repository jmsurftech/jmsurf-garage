-- HRM payroll suite: one-off adjustments per run, choosing who is in a run, line edits,
-- payment status per employee, back to draft, two-step approval, locked approved payrolls,
-- PRMF relief, net pay rounding in the books, and limits on staff loan requests.
-- Idempotent: safe to run again.

-- ── 1. columns ───────────────────────────────────────────────────────────────
alter table public.hr_employees add column if not exists prmf_contribution numeric not null default 0;

alter table public.hr_payroll_runs add column if not exists excluded_employee_ids uuid[] not null default '{}';
alter table public.hr_payroll_runs add column if not exists computed_by uuid;
alter table public.hr_payroll_runs add column if not exists computed_at timestamptz;
alter table public.hr_payroll_runs add column if not exists reopened_by uuid;
alter table public.hr_payroll_runs add column if not exists reopened_at timestamptz;

alter table public.hr_payslips add column if not exists pay_status text not null default 'pending';
alter table public.hr_payslips drop constraint if exists hr_payslips_pay_status_check;
alter table public.hr_payslips add constraint hr_payslips_pay_status_check check (pay_status in ('pending', 'paid', 'failed'));
alter table public.hr_payslips add column if not exists pay_reference text;
alter table public.hr_payslips add column if not exists paid_at timestamptz;
alter table public.hr_payslips add column if not exists edited_by uuid;
alter table public.hr_payslips add column if not exists edited_at timestamptz;

-- lines of runs already paid count as paid
update public.hr_payslips s set pay_status = 'paid', paid_at = coalesce(s.paid_at, r.paid_at)
  from public.hr_payroll_runs r where r.id = s.run_id and r.status = 'paid' and s.pay_status = 'pending';

-- ── 2. one-off adjustments for one run (bonus, commission, arrears, fines, reimbursements) ──
create table if not exists public.hr_payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  run_id uuid not null references public.hr_payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  kind text not null default 'earning' check (kind in ('earning', 'nontaxable', 'benefit', 'deduction')),
  name text not null,
  amount numeric not null check (amount > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists hr_payroll_adjustments_run_idx on public.hr_payroll_adjustments (run_id);
create index if not exists hr_payroll_adjustments_tenant_idx on public.hr_payroll_adjustments (tenant_id);
alter table public.hr_payroll_adjustments enable row level security;
drop policy if exists hr_payroll_adjustments_rw on public.hr_payroll_adjustments;
create policy hr_payroll_adjustments_rw on public.hr_payroll_adjustments for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.hr_can())
  with check (tenant_id = public.current_user_tenant_id() and public.hr_can());
grant select, insert, update, delete on public.hr_payroll_adjustments to authenticated;

-- ── 3. approved and paid payrolls are locked ─────────────────────────────────
-- Pay figures of a line cannot change once its run is approved; payment status,
-- reference and sending columns still can. Send the run back to draft to change pay.
create or replace function public.hr_payslip_lock() returns trigger language plpgsql set search_path = public as $$
declare st text;
begin
  select status into st from public.hr_payroll_runs where id = coalesce(new.run_id, old.run_id);
  if st is null or st = 'draft' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and (new.run_id, new.employee_id, new.basic, new.gross, new.taxable_pay, new.nssf, new.shif, new.housing_levy, new.paye,
       new.loan_deductions, new.other_deductions, new.net_pay, new.employer_nssf, new.employer_housing, new.nita, new.data)
     is not distinct from (old.run_id, old.employee_id, old.basic, old.gross, old.taxable_pay, old.nssf, old.shif, old.housing_levy, old.paye,
       old.loan_deductions, old.other_deductions, old.net_pay, old.employer_nssf, old.employer_housing, old.nita, old.data) then
    return new;
  end if;
  raise exception 'This payroll is approved, so its payslips are locked. Send it back to draft first.';
end $$;
drop trigger if exists hr_payslip_lock on public.hr_payslips;
create trigger hr_payslip_lock before insert or update or delete on public.hr_payslips for each row execute function public.hr_payslip_lock();

create or replace function public.hr_adjustment_lock() returns trigger language plpgsql set search_path = public as $$
declare st text;
begin
  select status into st from public.hr_payroll_runs where id = coalesce(new.run_id, old.run_id);
  if st is not null and st <> 'draft' then raise exception 'Adjustments can only change while the payroll is a draft.'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists hr_adjustment_lock on public.hr_payroll_adjustments;
create trigger hr_adjustment_lock before insert or update or delete on public.hr_payroll_adjustments for each row execute function public.hr_adjustment_lock();

create or replace function public.hr_run_delete_lock() returns trigger language plpgsql set search_path = public as $$
begin
  if old.status <> 'draft' then raise exception 'Only a draft payroll can be deleted.'; end if;
  return old;
end $$;
drop trigger if exists hr_run_delete_lock on public.hr_payroll_runs;
create trigger hr_run_delete_lock before delete on public.hr_payroll_runs for each row execute function public.hr_run_delete_lock();

-- ── 4. approve (optionally two-step) and back to draft ──────────────────────
create or replace function public.hr_payroll_option(p_tenant uuid, p_key text) returns text language sql stable security definer set search_path = public as $$
  select erp_settings -> 'hrm' -> 'payroll' ->> p_key from public.business_settings where tenant_id = p_tenant limit 1
$$;
revoke all on function public.hr_payroll_option(uuid, text) from public, anon;
grant execute on function public.hr_payroll_option(uuid, text) to authenticated;

-- Approves a draft run: loan and advance instalments on its lines are taken off the balances.
create or replace function public.hr_payroll_approve(p_run uuid) returns void language plpgsql security definer set search_path = public as $$
declare r public.hr_payroll_runs; s record; l jsonb; v_bal numeric;
begin
  select * into r from public.hr_payroll_runs where id = p_run and tenant_id = public.current_user_tenant_id() for update;
  if r.id is null then raise exception 'Payroll not found'; end if;
  if not public.hr_can() then raise exception 'Not allowed'; end if;
  if r.status <> 'draft' then raise exception 'This payroll is already approved'; end if;
  if not exists (select 1 from public.hr_payslips where run_id = p_run) then raise exception 'Nothing to approve: the payroll has no lines'; end if;
  if coalesce(public.hr_payroll_option(r.tenant_id, 'two_step'), 'false') = 'true'
     and coalesce(r.computed_by, r.created_by) = auth.uid() then
    raise exception 'Two-step approval is on: someone other than the person who prepared this payroll must approve it.';
  end if;
  for s in select id, employee_id, data from public.hr_payslips where run_id = p_run loop
    for l in select * from jsonb_array_elements(coalesce(s.data -> 'loans', '[]'::jsonb)) loop
      update public.hr_loans set balance = greatest(0, balance - (l ->> 'amount')::numeric),
             status = case when balance - (l ->> 'amount')::numeric <= 0.005 then 'cleared' else 'active' end
       where id = (l ->> 'id')::uuid and tenant_id = r.tenant_id and status = 'active'
       returning balance into v_bal;
      if found then
        insert into public.hr_loan_repayments (tenant_id, loan_id, employee_id, run_id, payslip_id, amount, balance_after, paid_on, note)
        values (r.tenant_id, (l ->> 'id')::uuid, s.employee_id, r.id, s.id, (l ->> 'amount')::numeric, v_bal, coalesce(r.pay_date, current_date), 'Payroll ' || r.period);
      end if;
    end loop;
  end loop;
  update public.hr_payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_run;
end $$;
revoke all on function public.hr_payroll_approve(uuid) from public, anon;
grant execute on function public.hr_payroll_approve(uuid) to authenticated;

-- Sends an approved (not yet paid) run back to draft: instalments go back on the loans and the journal is reversed.
create or replace function public.hr_payroll_reopen(p_run uuid) returns void language plpgsql security definer set search_path = public as $$
declare r public.hr_payroll_runs; x record;
begin
  select * into r from public.hr_payroll_runs where id = p_run and tenant_id = public.current_user_tenant_id() for update;
  if r.id is null then raise exception 'Payroll not found'; end if;
  if not public.hr_can() then raise exception 'Not allowed'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved payroll that is not yet paid can go back to draft'; end if;
  for x in select loan_id, sum(amount) amt from public.hr_loan_repayments where run_id = p_run group by loan_id loop
    update public.hr_loans set balance = least(principal, balance + x.amt), status = 'active' where id = x.loan_id and status in ('active', 'cleared');
  end loop;
  delete from public.hr_loan_repayments where run_id = p_run;
  update public.hr_payroll_runs set status = 'draft', approved_by = null, approved_at = null, reopened_by = auth.uid(), reopened_at = now() where id = p_run;
end $$;
revoke all on function public.hr_payroll_reopen(uuid) from public, anon;
grant execute on function public.hr_payroll_reopen(uuid) to authenticated;

-- ── 5. books: net pay rounded to whole shillings ─────────────────────────────
-- Net pay on a line may be rounded (data.net_rounding = rounded - exact); the difference goes to Rounding.
create or replace function public.acc_post_payroll(r public.hr_payroll_runs)
returns void language plpgsql security definer set search_path = public as $$
declare s record; v_date date := coalesce(r.pay_date, r.period_end, r.created_at::date);
begin
  if r.status not in ('approved', 'paid') then
    perform public.acc_post(r.tenant_id, 'payroll', r.id, v_date, r.period, null, '[]'::jsonb);
    perform public.acc_post(r.tenant_id, 'payroll_payment', r.id, v_date, r.period, null, '[]'::jsonb);
    return;
  end if;
  perform public.acc_seed_payroll_accounts(r.tenant_id);
  select coalesce(sum(gross), 0) gross, coalesce(sum(paye), 0) paye, coalesce(sum(nssf), 0) nssf, coalesce(sum(shif), 0) shif,
         coalesce(sum(housing_levy), 0) housing, coalesce(sum(loan_deductions), 0) loans, coalesce(sum(other_deductions), 0) other,
         coalesce(sum(net_pay), 0) net, coalesce(sum(employer_nssf), 0) er_nssf, coalesce(sum(employer_housing), 0) er_housing, coalesce(sum(nita), 0) nita,
         coalesce(sum(coalesce((data ->> 'net_rounding')::numeric, 0)), 0) rnd
    into s from public.hr_payslips where run_id = r.id;
  perform public.acc_post(r.tenant_id, 'payroll', r.id, v_date, 'Payroll ' || coalesce(r.period, ''), 'Payroll', jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'salaries'), 'debit', s.gross, 'description', 'Gross pay'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'employer_costs'), 'debit', s.er_nssf + s.er_housing + s.nita, 'description', 'Employer NSSF, Housing Levy and NITA'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'rounding'), 'debit', greatest(s.rnd, 0), 'credit', greatest(-s.rnd, 0), 'description', 'Net pay rounding'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'paye'), 'credit', s.paye, 'description', 'PAYE'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'nssf'), 'credit', s.nssf + s.er_nssf, 'description', 'NSSF (employee + employer)'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'shif'), 'credit', s.shif, 'description', 'SHIF'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'housing_levy'), 'credit', s.housing + s.er_housing, 'description', 'Housing Levy (employee + employer)'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'nita'), 'credit', s.nita, 'description', 'NITA'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'advances'), 'credit', s.loans, 'description', 'Loan and advance recoveries'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'payroll_other'), 'credit', s.other, 'description', 'Other deductions'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'salaries_payable'), 'credit', s.net, 'description', 'Net pay due')));
  if r.status = 'paid' then
    perform public.acc_post(r.tenant_id, 'payroll_payment', r.id, coalesce(r.paid_at::date, v_date), 'Payroll ' || coalesce(r.period, ''), 'Salaries paid', jsonb_build_array(
      jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'salaries_payable'), 'debit', s.net, 'description', 'Net pay'),
      jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'bank'), 'credit', s.net, 'description', 'Salaries paid')));
  else
    perform public.acc_post(r.tenant_id, 'payroll_payment', r.id, v_date, null, null, '[]'::jsonb);
  end if;
end $$;
revoke all on function public.acc_post_payroll(public.hr_payroll_runs) from public, anon, authenticated;

-- ── 6. staff loan and advance requests: optional limits ──────────────────────
-- erp_settings.hrm.payroll: advance_max_pct (open advances as % of basic), loan_max_amount, loan_max_months.
create or replace function public.hr_request_loan(p_kind text, p_amount numeric, p_months int, p_reason text) returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid := public.hr_my_employee_id(); nid uuid; t uuid := public.current_user_tenant_id();
        v_kind text := coalesce(nullif(p_kind, ''), 'advance'); v_basic numeric; v_open numeric;
        v_pct numeric := nullif(public.hr_payroll_option(t, 'advance_max_pct'), '')::numeric;
        v_max numeric := nullif(public.hr_payroll_option(t, 'loan_max_amount'), '')::numeric;
        v_months int := nullif(public.hr_payroll_option(t, 'loan_max_months'), '')::numeric::int;
begin
  if eid is null then raise exception 'Your login is not linked to an employee record. Ask HR.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  if exists (select 1 from public.hr_loans where employee_id = eid and status = 'requested') then raise exception 'You already have a request waiting for HR'; end if;
  if v_kind = 'advance' and v_pct is not null and v_pct > 0 then
    select basic_salary into v_basic from public.hr_employees where id = eid;
    select coalesce(sum(balance), 0) into v_open from public.hr_loans where employee_id = eid and kind = 'advance' and status = 'active';
    if v_open + p_amount > round(coalesce(v_basic, 0) * v_pct / 100, 2) then
      raise exception 'Advances are limited to % %% of your basic pay, including advances not yet repaid', v_pct;
    end if;
  end if;
  if v_kind = 'loan' and v_max is not null and v_max > 0 and p_amount > v_max then
    raise exception 'The most you can ask for is KES %', to_char(v_max, 'FM999,999,999,990');
  end if;
  if v_kind = 'loan' and v_months is not null and v_months > 0 and coalesce(p_months, 1) > v_months then
    raise exception 'Loans are repaid over at most % months', v_months;
  end if;
  insert into public.hr_loans (tenant_id, employee_id, kind, principal, monthly_installment, balance, issued_on, status, note, reason, requested_by)
  values (t, eid, v_kind, p_amount, round(p_amount / greatest(coalesce(p_months, 1), 1), 2), p_amount, current_date, 'requested', null, p_reason, auth.uid())
  returning id into nid;
  return nid;
end $$;
grant execute on function public.hr_request_loan(text, numeric, int, text) to authenticated;
