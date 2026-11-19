-- JMSURF Garage: module catalogue, plans by garage size and module billing.
-- Mirrors src/lib/modules.ts and src/lib/garagePlans.ts (keep in step). Idempotent: safe to run again.
--
--  * platform_modules: Garage Core (garage_core, was books) + the garage modules; suites that make no
--    sense for garages are hidden (is_active = false), never deleted. Two billing rows ride on the
--    existing module billing: extra_branch (KES 2,000 per extra branch) and prorata (pro-rata charges
--    for a module or plan switched on mid-period), so the renewal bill picks them up as it does modules.
--  * plans: Fundi, Starter, Business, Pro, Enterprise (quoted) and the All modules bundle. Older plans
--    are switched off (companies on them keep their subscription).
--  * Modules: switching on works at once (14 days free the first time; after that the bill rises
--    pro-rata to the end of the paid period); switching off stops at the end of the paid period and the
--    data stays read-only (app_records update needs the module on); only the owner, an admin or a role
--    with "Modules, plan and billing" may buy or remove.
--  * Sign-up: the chosen size (plan_code) and business kinds are saved on the company.

-- ── Columns ─────────────────────────────────────────────────────────────
alter table public.platform_modules add column if not exists kind text not null default 'module';
alter table public.platform_modules add column if not exists hidden boolean not null default false;
alter table public.plans add column if not exists code text;
alter table public.plans add column if not exists quote_only boolean not null default false;
alter table public.plans add column if not exists price_semi_annually numeric;
create unique index if not exists plans_code_key on public.plans (lower(code)) where code is not null;
alter table public.tenant_modules add column if not exists prorata_due numeric(12,2) not null default 0;
alter table public.subscriptions add column if not exists extra_branches integer not null default 0;
alter table public.subscriptions add column if not exists next_plan_id uuid references public.plans(id) on delete set null;

-- ── Which module sells an app (older app keys included) ─────────────────
create or replace function public.module_of(p_key text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_key in ('books', 'sales', 'purchases', 'reports', 'documents', 'approvals', 'discuss') then 'garage_core'
    when p_key in ('banking', 'accountant', 'statements') then 'accounting'
    when p_key in ('fixed_assets', 'subscriptions', 'esg', 'practice') then 'finance_plus'
    when p_key in ('pipeline', 'leads', 'activities', 'forecast') then 'crm'
    when p_key in ('marketing_automation', 'email_marketing', 'sms_marketing', 'social', 'events', 'surveys') then 'marketing'
    when p_key in ('pos', 'ecommerce', 'rental', 'loyalty', 'repairs') then 'commerce'
    when p_key in ('stock', 'transfers', 'shipments', 'fleet') then 'inventory'
    when p_key in ('quality', 'maintenance', 'plm', 'iot') then 'manufacturing'
    when p_key in ('employees', 'attendance', 'payroll', 'recruitment', 'appraisals', 'planning') then 'hrm'
    when p_key = 'timesheets' then 'projects'
    when p_key in ('helpdesk', 'live_chat', 'field_service', 'appointments', 'frontdesk') then 'service'
    when p_key = 'sign' then 'contracts'
    when p_key in ('blog', 'forum', 'elearning') then 'website'
    when p_key in ('knowledge', 'spreadsheets') then 'workplace'
    when p_key = 'analytics' then 'ai'
    when p_key = 'voip' then 'callcentre'
    when p_key like 'studio:%' then 'studio'
    -- Garage record apps are named after their module (insurance_claim → insurance); longest first.
    when left(p_key, 16) = 'fleet_contracts_' then 'fleet_contracts'
    when left(p_key, 13) = 'workshop_pro_' then 'workshop_pro'
    when left(p_key, 13) = 'vehicle_yard_' then 'vehicle_yard'
    when left(p_key, 10) = 'insurance_' then 'insurance'
    when left(p_key, 10) = 'body_paint_' then 'body_paint'
    when left(p_key, 9) = 'whatsapp_' then 'whatsapp'
    when left(p_key, 9) = 'car_wash_' then 'car_wash'
    when left(p_key, 9) = 'car_hire_' then 'car_hire'
    when left(p_key, 8) = 'imports_' then 'imports'
    when left(p_key, 7) = 'towing_' then 'towing'
    when left(p_key, 6) = 'tyres_' then 'tyres'
    when left(p_key, 7) = 'garage_' and p_key <> 'garage_core' then 'garage_core'
    else p_key end
$$;
grant execute on function public.module_of(text) to authenticated, service_role;

-- ── Catalogue ───────────────────────────────────────────────────────────
-- JMSURF BOOKS is Garage Core now (same row, so nothing that points at it breaks).
do $$ begin
  if exists (select 1 from public.platform_modules where key = 'books')
     and not exists (select 1 from public.platform_modules where key = 'garage_core') then
    update public.platform_modules set key = 'garage_core' where key = 'books';
  end if;
end $$;

-- Prices are only set when a row is new: the platform owner's own prices (super admin) are kept.
insert into public.platform_modules (key, name, category, description, price_monthly, included, sort, is_active, kind, hidden) values
  ('garage_core', 'Garage Core', 'Workshop', 'Job cards, customers and vehicles, estimates, M-Pesa, eTIMS invoices and SMS: what every garage needs.', 0, true, 10, true, 'module', false),
  ('workshop_pro', 'Workshop Pro', 'Workshop', 'Inspections with photos, a live bay board and a phone app for mechanics.', 1000, false, 20, true, 'module', false),
  ('inventory', 'Parts & Stock', 'Parts & sales', 'Full parts stock: stores and branches, purchase orders, receiving, transfers and stock-takes.', 1500, false, 30, true, 'module', false),
  ('commerce', 'Spares POS & Wholesale', 'Parts & sales', 'A fast till for the spares counter, price lists for wholesale buyers, and loyalty.', 1500, false, 40, true, 'module', false),
  ('website', 'Online Parts Shop & Website', 'Parts & sales', 'Your garage website and an online parts shop on your own address.', 1000, false, 50, true, 'module', false),
  ('imports', 'Imports & Landed Cost', 'Parts & sales', 'Import parts and vehicles: shipments, duty, clearing and the true landed cost of every item.', 3000, false, 60, true, 'module', false),
  ('insurance', 'Insurance Claims', 'Specialist', 'Accident repairs for insurers: claims, assessments, approvals, excess and payments.', 1500, false, 70, true, 'module', false),
  ('vehicle_yard', 'Vehicle Yard & Car Sales', 'Specialist', 'Cars for sale: stock, costs, reconditioning, deposits, sales and logbook transfer.', 2000, false, 80, true, 'module', false),
  ('body_paint', 'Body & Paint', 'Specialist', 'Panel beating and spray painting: stages, paint mixing and materials per job.', 2000, false, 90, true, 'module', false),
  ('car_wash', 'Car Wash & Detailing', 'Specialist', 'Washes, packages and detailing with a queue, attendants commission and M-Pesa.', 1000, false, 100, true, 'module', false),
  ('tyres', 'Tyres, Alignment & Batteries', 'Specialist', 'Tyre sizes and stock, alignment and balancing, battery tests and warranties.', 800, false, 110, true, 'module', false),
  ('fleet_contracts', 'Fleet Contracts & Fleet Portal', 'Specialist', 'Service contracts for companies with many vehicles, with their own portal.', 2500, false, 120, true, 'module', false),
  ('towing', 'Towing & Mobile Mechanic', 'Specialist', 'Tow and roadside call-outs: dispatch, distance charges and jobs on the road.', 1500, false, 130, true, 'module', false),
  ('car_hire', 'Car Hire', 'Specialist', 'Rent out cars: bookings, deposits, hand-over checks and returns.', 1500, false, 140, true, 'module', false),
  ('accounting', 'Accounting', 'Finance & people', 'Chart of accounts, journals, banking, financial statements, VAT return and budgets.', 1500, false, 150, true, 'module', false),
  ('hrm', 'Payroll & HR', 'Finance & people', 'Staff files, attendance, leave and Kenyan payroll with PAYE, NSSF, SHIF and Housing Levy.', 1500, false, 160, true, 'module', false),
  ('expense', 'Expense Claims', 'Finance & people', 'Staff claims for fuel, parts runs and trips, approved and refunded by M-Pesa.', 800, false, 170, true, 'module', false),
  ('whatsapp', 'WhatsApp Inbox', 'Customers & marketing', 'One shared WhatsApp inbox for the garage, linked to customers and jobs.', 1000, false, 180, true, 'module', false),
  ('crm', 'CRM', 'Customers & marketing', 'Leads, follow-ups and deals for fleet, dealer and trade customers.', 1500, false, 190, true, 'module', false),
  ('marketing', 'Marketing', 'Customers & marketing', 'Service reminders, SMS and email campaigns, and offers to past customers.', 2000, false, 200, true, 'module', false),
  ('service', 'Helpdesk & Bookings', 'Customers & marketing', 'Complaints and warranty tickets, website chat and online appointment booking.', 1800, false, 210, true, 'module', false),
  ('callcentre', 'JMSURF Call Centre', 'Customers & marketing', 'Phone lines with a menu, queues and recording, linked to every customer.', 2500, false, 220, true, 'module', false),
  ('projects', 'Projects', 'Extras', 'Big jobs such as rebuilds and fleet refits as projects with tasks and costs.', 1200, false, 230, true, 'module', false),
  ('contracts', 'Contracts & e-Sign', 'Extras', 'Service agreements and electronic signatures from any phone.', 1200, false, 240, true, 'module', false),
  ('workplace', 'Knowledge & Sheets', 'Extras', 'How-to guides for your team and spreadsheets next to your data.', 600, false, 250, true, 'module', false),
  ('ai', 'Garage AI', 'Extras', 'Ask about your garage in plain words: who owes you, which jobs pay best.', 1900, false, 260, true, 'module', false),
  -- Billing rows (never shown in the store).
  ('extra_branch', 'Extra branches', 'Billing', 'Each branch above what the plan includes, per month.', 2000, false, 900, true, 'addon', true),
  ('prorata', 'Pro-rata charges', 'Billing', 'Modules, branches or a bigger plan switched on part-way through a paid period.', 0, false, 910, true, 'charge', true)
on conflict (key) do update set
  name = excluded.name, category = excluded.category, description = excluded.description,
  included = excluded.included, sort = excluded.sort, kind = excluded.kind, hidden = excluded.hidden,
  -- Core is always free. Rows last changed before the garage launch take the garage price; a price the
  -- platform owner set after that (super admin) is kept when this runs again.
  price_monthly = case when excluded.included then 0
                       when public.platform_modules.updated_at < timestamptz '2026-11-20 00:00:00+03' then excluded.price_monthly
                       else public.platform_modules.price_monthly end,
  is_active = case when excluded.hidden then true else public.platform_modules.is_active end,
  updated_at = now();

-- Suites that make no sense for garages: hidden, not deleted (companies that had them keep their data).
update public.platform_modules set is_active = false, hidden = true, updated_at = now()
 where key in ('finance_plus', 'manufacturing', 'studio');

-- ── Plans by garage size ────────────────────────────────────────────────
update public.plans set is_active = false, updated_at = now()
 where code is null or lower(code) not in ('fundi', 'starter', 'business', 'pro', 'enterprise', 'all_modules');

with p(code, name, price, users, branches, inc, descr, quote, sort) as (values
  ('fundi', 'Fundi', 500, 3, 1, '{}'::text[], 'For the roadside fundi and one-man garage: job cards, M-Pesa, eTIMS invoices and SMS.', false, 10),
  ('starter', 'Starter', 2000, 5, 1, '{}'::text[], 'For a small garage with a few mechanics and a front desk.', false, 20),
  ('business', 'Business', 5000, 15, 1, '{workshop_pro,inventory,accounting}'::text[], 'For a busy workshop: inspections, bay board, full parts stock and accounting included.', false, 30),
  ('pro', 'Pro', 12000, 40, 2, '{workshop_pro,inventory,accounting,hrm,insurance}'::text[], 'For big workshops and dealers: adds payroll and insurance claims, two branches.', false, 40),
  ('enterprise', 'Enterprise', 0, 999999, 999, '{workshop_pro,inventory,accounting,hrm,insurance,commerce,website,imports,vehicle_yard,body_paint,car_wash,tyres,fleet_contracts,towing,car_hire,whatsapp}'::text[], 'For groups and dealers with many branches: priced for you. Talk to us.', true, 50),
  ('all_modules', 'All modules', 25000, 40, 2, '{workshop_pro,inventory,accounting,hrm,insurance,commerce,website,imports,vehicle_yard,body_paint,car_wash,tyres,fleet_contracts,towing,car_hire,whatsapp}'::text[], 'Pro plus every garage module for one price.', false, 60)
)
insert into public.plans (code, name, price_monthly, price_quarterly, price_semi_annually, price_annually, max_users, max_locations,
  trial_days, is_active, features, all_modules, included_modules, description, quote_only, sort)
select p.code, p.name, p.price, p.price * 3, p.price * 6, p.price * 10, p.users, p.branches, 14, true, '{}'::jsonb, false, p.inc, p.descr, p.quote, p.sort
  from p where not exists (select 1 from public.plans x where lower(x.code) = p.code);
-- Existing garage plans stay as the platform owner priced them; only switched back on.
update public.plans set is_active = true, updated_at = now()
 where lower(code) in ('fundi', 'starter', 'business', 'pro', 'enterprise', 'all_modules') and not is_active;

-- ── Is a module on for a company ────────────────────────────────────────
-- A module switched off stays usable until the end of the period already paid for.
create or replace function public.tenant_module_active(p_tenant uuid, p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  with k as (select public.module_of(p_key) as key)
  select
    coalesce((select included from public.platform_modules, k where platform_modules.key = k.key), false)
    or exists (
      select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id, k
      where s.tenant_id = p_tenant and ((p.all_modules and k.key <> 'callcentre') or k.key = any (p.included_modules))
    )
    or exists (
      select 1 from public.tenant_modules m, k
      where m.tenant_id = p_tenant and m.module_key = k.key
        and (m.status = 'comped'
          or (m.status = 'trial' and coalesce(m.trial_ends_at, now()) > now())
          or (m.status in ('active', 'past_due') and coalesce(m.current_period_end, now() + interval '1 day') > now() - interval '3 days')
          or (m.status = 'cancelled' and m.current_period_end is not null and m.current_period_end > now()))
    )
$function$;
revoke all on function public.tenant_module_active(uuid, text) from public, anon;
grant execute on function public.tenant_module_active(uuid, text) to authenticated, service_role;

-- ── Who may buy or remove modules ───────────────────────────────────────
create or replace function public.garage_can_bill()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin')
    or exists (select 1 from public.tenants t where t.id = public.current_user_tenant_id() and t.owner_user_id = auth.uid())
    or exists (select 1 from public.tenant_members m where m.tenant_id = public.current_user_tenant_id() and m.user_id = auth.uid() and m.status = 'active' and m.is_owner)
    or exists (select 1 from public.profiles p join public.company_roles r on r.id = p.company_role_id
                where p.user_id = auth.uid() and coalesce((r.permissions ->> 'settings.modules')::boolean, false))
  )
$$;
grant execute on function public.garage_can_bill() to authenticated;

-- ── Pro-rata charges (one billing row per company, cleared by the next renewal) ──
create or replace function public.garage_add_prorata(p_tenant uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  _sub public.subscriptions;
  _months int;
  _due numeric;
begin
  if coalesce(p_amount, 0) <= 0 then return; end if;
  select * into _sub from public.subscriptions where tenant_id = p_tenant order by created_at desc limit 1;
  -- The renewal multiplies a module's monthly price by the months in the cycle: store the share per month.
  _months := case _sub.billing_cycle when 'quarterly' then 3 when 'semi_annually' then 6 when 'annually' then 12 else 1 end;
  perform set_config('garage.billing', 'on', true);
  select coalesce(prorata_due, 0) + round(p_amount) into _due from public.tenant_modules where tenant_id = p_tenant and module_key = 'prorata';
  _due := coalesce(_due, round(p_amount));
  insert into public.tenant_modules (tenant_id, module_key, status, price_monthly, prorata_due, current_period_end, activated_by)
  values (p_tenant, 'prorata', 'active', round(_due / _months, 2), _due, _sub.current_period_end, auth.uid())
  on conflict (tenant_id, module_key) do update set status = 'active', price_monthly = round(_due / _months, 2), prorata_due = _due,
    cancelled_at = null, current_period_end = _sub.current_period_end, updated_at = now();
end $$;
revoke all on function public.garage_add_prorata(uuid, numeric) from public, anon, authenticated;

/** Days left in the paid period as a share of a month (30 days). */
create or replace function public.garage_month_share(p_end timestamptz)
returns numeric language sql stable as $$
  select greatest(0, extract(epoch from (p_end - now())) / 86400.0 / 30.0)::numeric
$$;

-- A renewal (period end moved on by the payment) clears the pro-rata charges it collected.
create or replace function public.garage_prorata_renewed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('garage.billing', true) = 'on' then return NEW; end if;
  if NEW.module_key = 'prorata' and NEW.current_period_end is distinct from OLD.current_period_end
     and NEW.current_period_end > coalesce(OLD.current_period_end, now()) then
    NEW.status := 'cancelled';
    NEW.price_monthly := 0;
    NEW.prorata_due := 0;
    NEW.current_period_end := null;
    NEW.cancelled_at := now();
  end if;
  return NEW;
end $$;
drop trigger if exists garage_prorata_renewed on public.tenant_modules;
create trigger garage_prorata_renewed before update on public.tenant_modules
  for each row execute function public.garage_prorata_renewed();

-- A plan change by the payment keeps the extra branches the company bought.
create or replace function public.garage_keep_extra_branches()
returns trigger language plpgsql security definer set search_path = public as $$
declare _base int;
begin
  if NEW.plan_id is distinct from OLD.plan_id or NEW.extra_branches is distinct from OLD.extra_branches then
    select max_locations into _base from public.plans where id = NEW.plan_id;
    if _base is not null then
      NEW.max_locations := greatest(coalesce(NEW.max_locations, 0), _base + coalesce(NEW.extra_branches, 0));
      if NEW.extra_branches is distinct from OLD.extra_branches then NEW.max_locations := _base + coalesce(NEW.extra_branches, 0); end if;
    end if;
  end if;
  if NEW.plan_id = NEW.next_plan_id then NEW.next_plan_id := null; end if;
  return NEW;
end $$;
drop trigger if exists garage_keep_extra_branches on public.subscriptions;
create trigger garage_keep_extra_branches before update on public.subscriptions
  for each row execute function public.garage_keep_extra_branches();

-- ── Switch a module on ──────────────────────────────────────────────────
create or replace function public.activate_module(p_key text)
returns public.tenant_modules
language plpgsql security definer set search_path to 'public' as $function$
declare
  _tenant uuid := public.current_user_tenant_id();
  _mod public.platform_modules;
  _row public.tenant_modules;
  _sub public.subscriptions;
  _on_trial boolean;
begin
  if _tenant is null then raise exception 'No company selected'; end if;
  if not public.garage_can_bill() then
    raise exception 'Only the owner or someone with billing rights can switch modules on';
  end if;
  select * into _mod from public.platform_modules where key = public.module_of(p_key) and is_active;
  if _mod.key is null then raise exception 'Unknown module'; end if;
  if _mod.included then raise exception 'This is part of Garage Core: it is always on'; end if;
  if coalesce(_mod.kind, 'module') <> 'module' then raise exception 'This is not a module'; end if;
  select * into _sub from public.subscriptions where tenant_id = _tenant order by created_at desc limit 1;
  _on_trial := _sub.status in ('trial', 'trialing') and coalesce(_sub.trial_ends_at, now()) > now();
  perform set_config('garage.billing', 'on', true);

  select * into _row from public.tenant_modules where tenant_id = _tenant and module_key = _mod.key;
  -- Already in the plan: nothing to switch on or pay.
  if exists (select 1 from public.plans p where p.id = _sub.plan_id
              and (_mod.key = any (p.included_modules) or (p.all_modules and _mod.key <> 'callcentre'))) then
    return _row;
  end if;
  if _row.id is null then
    -- First time: free for 14 days (or until the company's own trial ends, whichever is later).
    insert into public.tenant_modules (tenant_id, module_key, status, price_monthly, trial_ends_at, activated_by)
    values (_tenant, _mod.key, 'trial', _mod.price_monthly,
            greatest(now() + interval '14 days', case when _on_trial then _sub.trial_ends_at else now() end), auth.uid())
    returning * into _row;
  elsif _row.status in ('comped', 'active', 'past_due', 'trial') and public.tenant_module_active(_tenant, _mod.key)
        and not (_row.status in ('active', 'past_due') and _row.current_period_end is not null and _row.current_period_end <= now()) then
    null; -- already on
  elsif _row.status = 'cancelled' and _row.current_period_end is not null and _row.current_period_end > now() then
    -- Still inside the period paid for: back on, nothing to pay.
    update public.tenant_modules set status = 'active', cancelled_at = null, activated_by = auth.uid(), activated_at = now(), updated_at = now()
     where id = _row.id returning * into _row;
  elsif _on_trial then
    -- The company is still on its free trial: on until the trial ends, billed with the first payment.
    update public.tenant_modules set status = 'trial', trial_ends_at = _sub.trial_ends_at, price_monthly = _mod.price_monthly,
           cancelled_at = null, activated_by = auth.uid(), activated_at = now(), updated_at = now()
     where id = _row.id returning * into _row;
  elsif _sub.status = 'active' and _sub.current_period_end is not null and _sub.current_period_end > now() then
    -- Paid period running: on now, pro-rata to the end of the period, then at the full price with each renewal.
    update public.tenant_modules set status = 'active', price_monthly = _mod.price_monthly, current_period_end = _sub.current_period_end,
           cancelled_at = null, activated_by = auth.uid(), activated_at = now(), updated_at = now()
     where id = _row.id returning * into _row;
    perform public.garage_add_prorata(_tenant, _mod.price_monthly * public.garage_month_share(_sub.current_period_end));
  else
    -- No paid period running: on for 3 days while the payment goes through (on the next bill).
    update public.tenant_modules set status = 'past_due', price_monthly = _mod.price_monthly, cancelled_at = null,
           current_period_end = now(), activated_by = auth.uid(), activated_at = now(), updated_at = now()
     where id = _row.id returning * into _row;
  end if;
  perform public.record_tenant_activity(_tenant, auth.uid(), null, null, 'module_activated', 'module', _mod.key,
    case when _row.status = 'past_due' then 'Switched on ' || _mod.name || ' (payment due)' else 'Switched on ' || _mod.name end, '{}'::jsonb);
  return _row;
end $function$;
grant execute on function public.activate_module(text) to authenticated;

-- ── Switch a module off: it stops at the end of the paid period, data kept read-only ──
create or replace function public.deactivate_module(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare
  _tenant uuid := public.current_user_tenant_id();
  _row public.tenant_modules;
  _sub public.subscriptions;
  _key text := public.module_of(p_key);
  _until timestamptz;
begin
  if _tenant is null then raise exception 'No company selected'; end if;
  if not public.garage_can_bill() then
    raise exception 'Only the owner or someone with billing rights can switch modules off';
  end if;
  select * into _row from public.tenant_modules where tenant_id = _tenant and module_key = _key;
  if _row.id is null or _row.status = 'cancelled' then return; end if;
  if _row.status = 'comped' then raise exception 'JMSURF gives you this module free. Ask support to remove it.'; end if;
  select * into _sub from public.subscriptions where tenant_id = _tenant order by created_at desc limit 1;
  perform set_config('garage.billing', 'on', true);
  -- A trial or an unpaid module stops now; a paid one runs to the end of what was paid for.
  _until := case
    when _row.status = 'active' then greatest(coalesce(_row.current_period_end, _sub.current_period_end, now()), coalesce(_sub.current_period_end, now()))
    else null end;
  update public.tenant_modules set status = 'cancelled', cancelled_at = now(),
         current_period_end = case when _until is not null and _until > now() then _until else null end, updated_at = now()
   where id = _row.id;
  perform public.record_tenant_activity(_tenant, auth.uid(), null, null, 'module_deactivated', 'module', _key,
    'Switched off ' || coalesce((select name from public.platform_modules where key = _key), _key), '{}'::jsonb);
end $$;
grant execute on function public.deactivate_module(text) to authenticated;

-- ── Extra branches (KES 2,000 each per month) ───────────────────────────
create or replace function public.garage_set_extra_branches(p_count int)
returns public.subscriptions language plpgsql security definer set search_path = public as $$
declare
  _tenant uuid := public.current_user_tenant_id();
  _sub public.subscriptions;
  _unit numeric;
  _n int := greatest(0, least(coalesce(p_count, 0), 500));
  _added int;
  _on_trial boolean;
begin
  if _tenant is null then raise exception 'No company selected'; end if;
  if not public.garage_can_bill() then raise exception 'Only the owner or someone with billing rights can change branches'; end if;
  select * into _sub from public.subscriptions where tenant_id = _tenant order by created_at desc limit 1;
  if _sub.id is null then raise exception 'No plan yet'; end if;
  select price_monthly into _unit from public.platform_modules where key = 'extra_branch';
  _unit := coalesce(_unit, 2000);
  _added := _n - coalesce(_sub.extra_branches, 0);
  _on_trial := _sub.status in ('trial', 'trialing') and coalesce(_sub.trial_ends_at, now()) > now();
  perform set_config('garage.billing', 'on', true);
  update public.subscriptions set extra_branches = _n, updated_at = now() where id = _sub.id returning * into _sub;
  if _n = 0 then
    update public.tenant_modules set status = 'cancelled', cancelled_at = now(), current_period_end = null, updated_at = now()
     where tenant_id = _tenant and module_key = 'extra_branch';
  else
    insert into public.tenant_modules (tenant_id, module_key, status, price_monthly, trial_ends_at, current_period_end, activated_by)
    values (_tenant, 'extra_branch', case when _on_trial then 'trial' else 'active' end, _unit * _n,
            case when _on_trial then _sub.trial_ends_at end, case when _on_trial then null else _sub.current_period_end end, auth.uid())
    on conflict (tenant_id, module_key) do update set
      status = case when _on_trial then 'trial' else 'active' end, price_monthly = _unit * _n, cancelled_at = null,
      trial_ends_at = case when _on_trial then _sub.trial_ends_at else public.tenant_modules.trial_ends_at end,
      current_period_end = case when _on_trial then public.tenant_modules.current_period_end else _sub.current_period_end end,
      updated_at = now();
    if _added > 0 and not _on_trial and _sub.status = 'active' and _sub.current_period_end > now() then
      perform public.garage_add_prorata(_tenant, _added * _unit * public.garage_month_share(_sub.current_period_end));
    end if;
  end if;
  perform public.record_tenant_activity(_tenant, auth.uid(), null, null, 'branches_changed', 'subscription', _sub.id::text,
    'Extra branches set to ' || _n, '{}'::jsonb);
  return _sub;
end $$;
grant execute on function public.garage_set_extra_branches(int) to authenticated;

-- ── Change the base plan: up now (pro-rata), down at the next renewal ───
create or replace function public.garage_change_plan(p_plan uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  _tenant uuid := public.current_user_tenant_id();
  _sub public.subscriptions;
  _old numeric;
  _plan public.plans;
begin
  if _tenant is null then raise exception 'No company selected'; end if;
  if not public.garage_can_bill() then raise exception 'Only the owner or someone with billing rights can change the plan'; end if;
  select * into _plan from public.plans where id = p_plan and is_active;
  if _plan.id is null then raise exception 'That plan is not available'; end if;
  if _plan.quote_only then raise exception 'Enterprise is priced for you: contact JMSURF and we set it up'; end if;
  select * into _sub from public.subscriptions where tenant_id = _tenant order by created_at desc limit 1;
  if _sub.id is null then raise exception 'No plan yet'; end if;
  if _sub.plan_id = _plan.id then return 'same'; end if;
  _old := coalesce(nullif(_sub.price, 0), (select price_monthly from public.plans where id = _sub.plan_id), 0);
  perform set_config('garage.billing', 'on', true);
  if (_sub.status in ('trial', 'trialing')) or _sub.current_period_end is null or _sub.current_period_end <= now() or _plan.price_monthly >= _old then
    update public.subscriptions set plan_id = _plan.id, plan_name = _plan.name, price = _plan.price_monthly,
           max_users = _plan.max_users, max_locations = _plan.max_locations + coalesce(extra_branches, 0), next_plan_id = null, updated_at = now()
     where id = _sub.id;
    if _sub.status = 'active' and _sub.current_period_end > now() and _plan.price_monthly > _old then
      perform public.garage_add_prorata(_tenant, (_plan.price_monthly - _old) * public.garage_month_share(_sub.current_period_end));
      return 'upgraded';
    end if;
    return 'switched';
  end if;
  -- Moving down: the current plan runs to the end of the period paid for.
  update public.subscriptions set next_plan_id = _plan.id, updated_at = now() where id = _sub.id;
  return 'next_period';
end $$;
grant execute on function public.garage_change_plan(uuid) to authenticated;

-- ── Sign-up: size (plan) and business kinds saved on the company ────────
-- Runs after on_auth_user_created (handle_new_user), which creates the company and starts the
-- chosen modules' trials (start_apps). Never blocks a sign-up.
create or replace function public.garage_after_signup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _tenant uuid;
  _plan public.plans;
  _code text := lower(coalesce(NEW.raw_user_meta_data->>'plan_code', ''));
  _kinds jsonb := case when jsonb_typeof(NEW.raw_user_meta_data->'business_kinds') = 'array' then NEW.raw_user_meta_data->'business_kinds' else '[]'::jsonb end;
begin
  if coalesce(NEW.raw_user_meta_data->>'registration_type', '') <> 'tenant' then return NEW; end if;
  begin
    select id into _tenant from public.tenants where owner_user_id = NEW.id order by created_at desc limit 1;
    if _tenant is null then return NEW; end if;
    -- Enterprise is quoted: the garage starts on Pro while JMSURF prices it.
    if _code = 'enterprise' then _code := 'pro'; end if;
    if _code <> '' then
      select * into _plan from public.plans where lower(code) = _code and is_active limit 1;
      if _plan.id is not null then
        update public.subscriptions set plan_id = _plan.id, plan_name = _plan.name, price = _plan.price_monthly,
               max_users = _plan.max_users, max_locations = _plan.max_locations
         where tenant_id = _tenant and plan_id is distinct from _plan.id;
      end if;
    end if;
    update public.business_settings
       set erp_settings = coalesce(erp_settings, '{}'::jsonb)
             || jsonb_build_object('garage_business_kinds', _kinds, 'garage_size', nullif(lower(coalesce(NEW.raw_user_meta_data->>'plan_code', '')), ''),
                                   'garage_quote_requested', lower(coalesce(NEW.raw_user_meta_data->>'plan_code', '')) = 'enterprise')
     where tenant_id = _tenant;
  exception when others then
    raise warning 'Garage sign-up details for %: %', NEW.id, SQLERRM;
  end;
  return NEW;
end $$;
drop trigger if exists zz_garage_after_signup on auth.users;
create trigger zz_garage_after_signup after insert on auth.users
  for each row execute function public.garage_after_signup();
