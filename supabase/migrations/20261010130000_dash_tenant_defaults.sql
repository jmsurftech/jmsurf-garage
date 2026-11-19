-- Every company starts with sensible lookups (units, categories, CRM stages,
-- leave types, departments, Kenyan public holidays, a main location) and owns
-- its own expense and bill categories.

alter table public.expense_categories add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.bill_categories add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.expense_categories alter column tenant_id set default public.current_user_tenant_id();
alter table public.bill_categories alter column tenant_id set default public.current_user_tenant_id();

drop policy if exists exp_cats_select on public.expense_categories;
create policy exp_cats_select on public.expense_categories for select using (tenant_id = public.current_user_tenant_id() or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists exp_cats_tenant on public.expense_categories;
create policy exp_cats_tenant on public.expense_categories for all
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));
drop policy if exists bill_cats_select on public.bill_categories;
create policy bill_cats_select on public.bill_categories for select using (tenant_id = public.current_user_tenant_id() or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists bill_cats_tenant on public.bill_categories;
create policy bill_cats_tenant on public.bill_categories for all
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));
grant select, insert, update, delete on public.expense_categories, public.bill_categories to authenticated;

create or replace function public.seed_tenant_defaults(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare y int := extract(year from now())::int;
begin
  if not exists (select 1 from public.locations where tenant_id = p_tenant) then
    insert into public.locations (tenant_id, name, code, is_main) values (p_tenant, 'Head office', '00', true);
  end if;
  if not exists (select 1 from public.product_units where tenant_id = p_tenant) then
    insert into public.product_units (tenant_id, name, abbreviation, sort_order)
    select p_tenant, v.n, v.a, v.i from (values ('piece','pcs',1),('box','box',2),('pack','pk',3),('carton','ctn',4),('dozen','dz',5),('kg','kg',6),('g','g',7),('litre','L',8),('ml','ml',9),('metre','m',10),('hour','hr',11),('day','day',12),('month','mo',13),('service','svc',14)) v(n, a, i);
  end if;
  if not exists (select 1 from public.product_categories where tenant_id = p_tenant) then
    insert into public.product_categories (tenant_id, name, sort_order) values (p_tenant, 'General', 1), (p_tenant, 'Services', 2);
  end if;
  if not exists (select 1 from public.expense_categories where tenant_id = p_tenant) then
    insert into public.expense_categories (tenant_id, name, is_active)
    select p_tenant, n, true from unnest(array['Rent', 'Utilities', 'Salaries & wages', 'Transport', 'Fuel', 'Travel', 'Meals & entertainment', 'Marketing & advertising',
      'Office supplies', 'Telephone & internet', 'Repairs & maintenance', 'Insurance', 'Professional fees', 'Bank charges', 'M-Pesa charges', 'Licences & permits', 'Taxes', 'Training', 'Software & subscriptions', 'Other']) n;
  end if;
  if not exists (select 1 from public.bill_categories where tenant_id = p_tenant) then
    insert into public.bill_categories (tenant_id, name, is_active)
    select p_tenant, n, true from unnest(array['Stock purchase', 'Rent', 'Utilities', 'Electricity', 'Water', 'Internet', 'Subscriptions', 'Insurance', 'Professional fees', 'Repairs & maintenance', 'Other']) n;
  end if;
  if not exists (select 1 from public.crm_stages where tenant_id = p_tenant) then
    insert into public.crm_stages (tenant_id, name, sequence, is_won) values
      (p_tenant, 'New', 1, false), (p_tenant, 'Qualified', 2, false), (p_tenant, 'Proposal', 3, false), (p_tenant, 'Negotiation', 4, false), (p_tenant, 'Won', 5, true);
  end if;
  if not exists (select 1 from public.crm_activity_types where tenant_id = p_tenant) then
    insert into public.crm_activity_types (tenant_id, name, sequence, active) values
      (p_tenant, 'Call', 1, true), (p_tenant, 'Meeting', 2, true), (p_tenant, 'Email', 3, true), (p_tenant, 'WhatsApp', 4, true), (p_tenant, 'To-Do', 5, true), (p_tenant, 'Site visit', 6, true);
  end if;
  if not exists (select 1 from public.crm_lost_reasons where tenant_id = p_tenant) then
    insert into public.crm_lost_reasons (tenant_id, name, active) values
      (p_tenant, 'Too expensive', true), (p_tenant, 'Went to a competitor', true), (p_tenant, 'No budget', true), (p_tenant, 'No longer interested', true), (p_tenant, 'No response', true);
  end if;
  if not exists (select 1 from public.hr_leave_types where tenant_id = p_tenant) then
    insert into public.hr_leave_types (tenant_id, name, days_per_year, paid, gender, active) values
      (p_tenant, 'Annual leave', 21, true, null, true), (p_tenant, 'Sick leave', 14, true, null, true), (p_tenant, 'Maternity leave', 90, true, 'female', true),
      (p_tenant, 'Paternity leave', 14, true, 'male', true), (p_tenant, 'Compassionate leave', 5, true, null, true), (p_tenant, 'Study leave', 10, true, null, true), (p_tenant, 'Unpaid leave', 0, false, null, true);
  end if;
  if not exists (select 1 from public.hr_departments where tenant_id = p_tenant) then
    insert into public.hr_departments (tenant_id, name) select p_tenant, n from unnest(array['Management', 'Finance & administration', 'Sales & marketing', 'Operations', 'Customer service', 'Human resources', 'ICT']) n;
  end if;
  -- Kenyan public holidays this year (fixed dates; moveable feasts are added by the company).
  if not exists (select 1 from public.hr_holidays where tenant_id = p_tenant)
     and coalesce((select country from public.business_settings where tenant_id = p_tenant limit 1), 'KE') = 'KE' then
    insert into public.hr_holidays (tenant_id, date, name) values
      (p_tenant, make_date(y, 1, 1), 'New Year''s Day'), (p_tenant, make_date(y, 5, 1), 'Labour Day'), (p_tenant, make_date(y, 6, 1), 'Madaraka Day'),
      (p_tenant, make_date(y, 10, 10), 'Mazingira Day'), (p_tenant, make_date(y, 10, 20), 'Mashujaa Day'), (p_tenant, make_date(y, 12, 12), 'Jamhuri Day'),
      (p_tenant, make_date(y, 12, 25), 'Christmas Day'), (p_tenant, make_date(y, 12, 26), 'Boxing Day');
  end if;
  perform public.acc_seed(p_tenant);
  perform public.acc_seed_payroll_accounts(p_tenant);
end $$;
revoke all on function public.seed_tenant_defaults(uuid) from public, anon, authenticated;

-- Existing companies, then every new one (after its settings row exists, so the country is known).
do $$ declare t uuid; begin for t in select id from public.tenants loop perform public.seed_tenant_defaults(t); end loop; end $$;

create or replace function public.seed_defaults_on_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.seed_tenant_defaults(NEW.tenant_id); return NEW; end $$;
revoke all on function public.seed_defaults_on_settings() from public, anon, authenticated;
drop trigger if exists seed_defaults_on_settings on public.business_settings;
create trigger seed_defaults_on_settings after insert on public.business_settings
  for each row when (NEW.tenant_id is not null) execute function public.seed_defaults_on_settings();

-- create_company already adds a Head office location; skip a duplicate.
