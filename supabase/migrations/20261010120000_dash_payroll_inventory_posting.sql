-- Payroll and inventory adjustments post to the books too.
--  * approved / paid payroll run: Dr salaries + employer costs; Cr PAYE, NSSF, SHIF,
--    Housing Levy, NITA, loan recoveries, other deductions and net salaries payable
--  * paid payroll run: Dr net salaries payable, Cr bank
--  * applied inventory adjustment: value change between Inventory and the adjustment account

create or replace function public.acc_seed_payroll_accounts(p_tenant uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.chart_of_accounts (tenant_id, code, name, type, sub_type, system_key) values
    (p_tenant, '2170', 'NITA payable', 'liability', 'other_current_liability', 'nita'),
    (p_tenant, '2180', 'Other payroll deductions payable', 'liability', 'other_current_liability', 'payroll_other'),
    (p_tenant, '6160', 'Inventory adjustments', 'expense', 'cost_of_goods_sold', 'inventory_adjustments')
  on conflict do nothing;
$$;
do $$ declare t uuid; begin for t in select id from public.tenants loop perform public.acc_seed_payroll_accounts(t); end loop; end $$;

create or replace function public.acc_seed_new_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.acc_seed(NEW.id); perform public.acc_seed_payroll_accounts(NEW.id); return NEW; end $$;

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
         coalesce(sum(net_pay), 0) net, coalesce(sum(employer_nssf), 0) er_nssf, coalesce(sum(employer_housing), 0) er_housing, coalesce(sum(nita), 0) nita
    into s from public.hr_payslips where run_id = r.id;
  perform public.acc_post(r.tenant_id, 'payroll', r.id, v_date, 'Payroll ' || coalesce(r.period, ''), 'Payroll', jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'salaries'), 'debit', s.gross, 'description', 'Gross pay'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'employer_costs'), 'debit', s.er_nssf + s.er_housing + s.nita, 'description', 'Employer NSSF, Housing Levy and NITA'),
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

create or replace function public.acc_post_inventory_adjustment(r public.inventory_adjustments)
returns void language plpgsql security definer set search_path = public as $$
declare v numeric := coalesce(r.value_change, 0); v_acc uuid;
begin
  if r.status <> 'adjusted' or v = 0 then
    perform public.acc_post(r.tenant_id, 'inventory_adjustment', r.id, r.adjustment_date, r.adjustment_number, null, '[]'::jsonb); return;
  end if;
  perform public.acc_seed_payroll_accounts(r.tenant_id);
  v_acc := case when coalesce(r.account, '') = '' then public.acc_key(r.tenant_id, 'inventory_adjustments') else public.acc_expense_account(r.tenant_id, r.account) end;
  perform public.acc_post(r.tenant_id, 'inventory_adjustment', r.id, coalesce(r.adjustment_date, r.created_at::date), r.adjustment_number, r.reason, jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'inventory'), 'debit', greatest(v, 0), 'credit', greatest(-v, 0), 'description', coalesce(r.reason, 'Stock adjustment')),
    jsonb_build_object('account_id', v_acc, 'debit', greatest(-v, 0), 'credit', greatest(v, 0), 'description', coalesce(r.reason, 'Stock adjustment'))));
end $$;

create or replace function public.acc_document_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tenant uuid;
begin
  begin
    if TG_OP = 'DELETE' then
      v_id := OLD.id; v_tenant := OLD.tenant_id;
      delete from public.journals where tenant_id = v_tenant and source_id = v_id and source_type in (TG_ARGV[0], 'payroll_payment');
      return OLD;
    end if;
    case TG_TABLE_NAME
      when 'invoices' then perform public.acc_post_invoice(NEW);
      when 'payments_received' then perform public.acc_post_payment_received(NEW);
      when 'credit_notes' then perform public.acc_post_credit_note(NEW);
      when 'bills' then perform public.acc_post_bill(NEW);
      when 'supplier_payments' then perform public.acc_post_supplier_payment(NEW);
      when 'vendor_credits' then perform public.acc_post_vendor_credit(NEW);
      when 'expenses' then perform public.acc_post_expense(NEW);
      when 'transactions' then perform public.acc_post_sale(NEW);
      when 'hr_payroll_runs' then perform public.acc_post_payroll(NEW);
      when 'inventory_adjustments' then perform public.acc_post_inventory_adjustment(NEW);
    end case;
  exception when others then
    if SQLERRM like 'The books are locked%' then raise; end if;
    insert into public.accounting_errors (tenant_id, source_type, source_id, message) values (NEW.tenant_id, TG_TABLE_NAME, NEW.id, left(SQLERRM, 500));
  end;
  return NEW;
end $$;

drop trigger if exists acc_post on public.hr_payroll_runs;
create trigger acc_post after insert or update or delete on public.hr_payroll_runs for each row execute function public.acc_document_trigger('payroll');
drop trigger if exists acc_post on public.inventory_adjustments;
create trigger acc_post after insert or update or delete on public.inventory_adjustments for each row execute function public.acc_document_trigger('inventory_adjustment');

-- Payslip changes (recalculation) re-post their run.
create or replace function public.acc_payslip_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.hr_payroll_runs;
begin
  select * into r from public.hr_payroll_runs where id = coalesce(NEW.run_id, OLD.run_id);
  if r.id is not null and r.status in ('approved', 'paid') then
    begin perform public.acc_post_payroll(r); exception when others then
      insert into public.accounting_errors (tenant_id, source_type, source_id, message) values (r.tenant_id, 'hr_payslips', r.id, left(SQLERRM, 500));
    end;
  end if;
  return null;
end $$;
drop trigger if exists acc_payslip_changed on public.hr_payslips;
create trigger acc_payslip_changed after insert or update or delete on public.hr_payslips for each row execute function public.acc_payslip_changed();

-- acc_repost_all also covers payroll and adjustments.
create or replace function public.acc_repost_all()
returns int language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_user_tenant_id(); n int := 0; r record;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Only the administrator can rebuild the books'; end if;
  for r in select * from public.invoices where tenant_id = v_tenant loop perform public.acc_post_invoice(r); n := n + 1; end loop;
  for r in select * from public.payments_received where tenant_id = v_tenant loop perform public.acc_post_payment_received(r); n := n + 1; end loop;
  for r in select * from public.credit_notes where tenant_id = v_tenant loop perform public.acc_post_credit_note(r); n := n + 1; end loop;
  for r in select * from public.bills where tenant_id = v_tenant loop perform public.acc_post_bill(r); n := n + 1; end loop;
  for r in select * from public.supplier_payments where tenant_id = v_tenant loop perform public.acc_post_supplier_payment(r); n := n + 1; end loop;
  for r in select * from public.vendor_credits where tenant_id = v_tenant loop perform public.acc_post_vendor_credit(r); n := n + 1; end loop;
  for r in select * from public.expenses where tenant_id = v_tenant loop perform public.acc_post_expense(r); n := n + 1; end loop;
  for r in select * from public.transactions where tenant_id = v_tenant loop perform public.acc_post_sale(r); n := n + 1; end loop;
  for r in select * from public.hr_payroll_runs where tenant_id = v_tenant loop perform public.acc_post_payroll(r); n := n + 1; end loop;
  for r in select * from public.inventory_adjustments where tenant_id = v_tenant loop perform public.acc_post_inventory_adjustment(r); n := n + 1; end loop;
  return n;
end $$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('acc_seed_payroll_accounts', 'acc_post_payroll', 'acc_post_inventory_adjustment', 'acc_payslip_changed', 'acc_document_trigger', 'acc_seed_new_tenant')
  loop execute format('revoke all on function %s from public, anon, authenticated', f); end loop;
end $$;
