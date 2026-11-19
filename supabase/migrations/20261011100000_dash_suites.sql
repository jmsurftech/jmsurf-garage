create or replace function public.module_of(p_key text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_key = 'sales' then 'books'
    when p_key = 'purchases' then 'books'
    when p_key = 'banking' then 'books'
    when p_key = 'accountant' then 'books'
    when p_key = 'reports' then 'books'
    when p_key = 'documents' then 'books'
    when p_key = 'approvals' then 'books'
    when p_key = 'discuss' then 'books'
    when p_key = 'fixed_assets' then 'finance_plus'
    when p_key = 'subscriptions' then 'finance_plus'
    when p_key = 'esg' then 'finance_plus'
    when p_key = 'practice' then 'finance_plus'
    when p_key = 'pipeline' then 'crm'
    when p_key = 'leads' then 'crm'
    when p_key = 'activities' then 'crm'
    when p_key = 'forecast' then 'crm'
    when p_key = 'marketing_automation' then 'marketing'
    when p_key = 'email_marketing' then 'marketing'
    when p_key = 'sms_marketing' then 'marketing'
    when p_key = 'social' then 'marketing'
    when p_key = 'events' then 'marketing'
    when p_key = 'surveys' then 'marketing'
    when p_key = 'pos' then 'commerce'
    when p_key = 'ecommerce' then 'commerce'
    when p_key = 'rental' then 'commerce'
    when p_key = 'loyalty' then 'commerce'
    when p_key = 'stock' then 'inventory'
    when p_key = 'transfers' then 'inventory'
    when p_key = 'shipments' then 'inventory'
    when p_key = 'fleet' then 'inventory'
    when p_key = 'quality' then 'manufacturing'
    when p_key = 'maintenance' then 'manufacturing'
    when p_key = 'plm' then 'manufacturing'
    when p_key = 'iot' then 'manufacturing'
    when p_key = 'employees' then 'hrm'
    when p_key = 'attendance' then 'hrm'
    when p_key = 'payroll' then 'hrm'
    when p_key = 'recruitment' then 'hrm'
    when p_key = 'appraisals' then 'hrm'
    when p_key = 'planning' then 'hrm'
    when p_key = 'timesheets' then 'projects'
    when p_key = 'helpdesk' then 'service'
    when p_key = 'live_chat' then 'service'
    when p_key = 'field_service' then 'service'
    when p_key = 'appointments' then 'service'
    when p_key = 'sign' then 'contracts'
    when p_key = 'blog' then 'website'
    when p_key = 'forum' then 'website'
    when p_key = 'elearning' then 'website'
    when p_key = 'knowledge' then 'workplace'
    when p_key = 'spreadsheets' then 'workplace'
    when p_key = 'analytics' then 'ai'
    when p_key = 'voip' then 'callcentre'
    when p_key like 'studio:%' then 'studio'
    else p_key end
$$;
grant execute on function public.module_of(text) to authenticated, service_role;

/** True when a company may use a module (or any app inside a suite) right now. */
create or replace function public.tenant_module_active(p_tenant uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  with k as (select public.module_of(p_key) as key)
  select
    coalesce((select included from public.platform_modules, k where platform_modules.key = k.key), false)
    or exists (
      select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id, k
      where s.tenant_id = p_tenant and (p.all_modules or k.key = any (p.included_modules))
    )
    or exists (
      select 1 from public.tenant_modules m, k
      where m.tenant_id = p_tenant and m.module_key = k.key
        and (m.status = 'comped'
          or (m.status = 'trial' and coalesce(m.trial_ends_at, now()) > now())
          or (m.status in ('active', 'past_due') and coalesce(m.current_period_end, now() + interval '1 day') > now() - interval '3 days'))
    )
$$;
revoke all on function public.tenant_module_active(uuid, text) from public, anon;
grant execute on function public.tenant_module_active(uuid, text) to authenticated, service_role;

-- JMSURF DASH suites: 48 small modules become 17 suites (generated from src/lib/modules.ts).
-- Older app keys (helpdesk, recruitment, social…) still gate their records: module_of() maps them.
insert into public.platform_modules (key, name, category, description, price_monthly, included, sort, is_active) values
  ('books', 'JMSURF BOOKS', 'Finance', 'Accounting, invoicing, purchases, banking and reports: the heart of every company.', 0, true, 10, true),
  ('finance_plus', 'JMSURF FINANCE+', 'Finance', 'Fixed assets, subscription billing, ESG reporting and practice management for accountants.', 1500, false, 20, true),
  ('expense', 'JMSURF EXPENSE', 'Finance', 'Expense claims, trips, mileage and advances with approvals and M-Pesa reimbursement.', 800, false, 30, true),
  ('crm', 'JMSURF CRM', 'Sales & Marketing', 'Leads, deals, pipeline, activities and forecasts, connected to quotes and invoices.', 1500, false, 40, true),
  ('marketing', 'JMSURF MARKETING', 'Sales & Marketing', 'Email, SMS, WhatsApp and social media campaigns, automation journeys, events and surveys in one suite.', 2000, false, 50, true),
  ('commerce', 'JMSURF COMMERCE', 'Sales & Marketing', 'Point of sale, online store, rentals and loyalty, all on the same stock and books.', 2000, false, 60, true),
  ('inventory', 'JMSURF INVENTORY', 'Operations', 'Warehouses, transfers, batches, serials, composite items, deliveries and fleet.', 1500, false, 70, true),
  ('manufacturing', 'JMSURF MANUFACTURING', 'Operations', 'Bills of materials, production, quality, maintenance, engineering changes and connected devices.', 3000, false, 80, true),
  ('hrm', 'JMSURF HRM', 'People', 'Employees, attendance, time off, Kenyan payroll, recruitment, appraisals and shift planning.', 2500, false, 90, true),
  ('projects', 'JMSURF PROJECTS', 'Services', 'Projects, tasks, milestones, timesheets and project billing.', 1200, false, 100, true),
  ('service', 'JMSURF SERVICE', 'Services', 'Helpdesk tickets from email, website live chat, field service and online appointment booking.', 1800, false, 110, true),
  ('contracts', 'JMSURF SIGN & CONTRACTS', 'Services', 'Contract lifecycle and legally binding electronic signatures.', 1200, false, 120, true),
  ('callcentre', 'JMSURF CALL CENTRE', 'Services', 'Cloud call centre with IVR, queues, browser phones and call recording, linked to every customer.', 2500, false, 130, true),
  ('website', 'JMSURF SITES', 'Digital', 'Website, blog, community forum and online courses on your own domain.', 1200, false, 140, true),
  ('workplace', 'JMSURF WORKPLACE', 'Productivity', 'Company knowledge base and spreadsheets next to your data.', 600, false, 150, true),
  ('ai', 'DASH AI', 'Productivity', 'Your AI business assistant and analytics: ask, analyse and act by chat or voice.', 1900, false, 160, true),
  ('studio', 'JMSURF STUDIO', 'Productivity', 'Build your own apps, fields and workflows without code.', 2500, false, 170, true)
on conflict (key) do update set name = excluded.name, category = excluded.category, description = excluded.description,
  price_monthly = excluded.price_monthly, included = excluded.included, sort = excluded.sort, is_active = true, updated_at = now();

-- Suites a company already had keep working: old rows move to their suite.
update public.tenant_modules tm set module_key = s.suite
from (values ('sales', 'books'), ('purchases', 'books'), ('banking', 'books'), ('accountant', 'books'), ('reports', 'books'), ('documents', 'books'), ('approvals', 'books'), ('discuss', 'books'), ('fixed_assets', 'finance_plus'), ('subscriptions', 'finance_plus'), ('esg', 'finance_plus'), ('practice', 'finance_plus'), ('pipeline', 'crm'), ('leads', 'crm'), ('activities', 'crm'), ('forecast', 'crm'), ('marketing_automation', 'marketing'), ('email_marketing', 'marketing'), ('sms_marketing', 'marketing'), ('social', 'marketing'), ('events', 'marketing'), ('surveys', 'marketing'), ('pos', 'commerce'), ('ecommerce', 'commerce'), ('rental', 'commerce'), ('loyalty', 'commerce'), ('stock', 'inventory'), ('transfers', 'inventory'), ('shipments', 'inventory'), ('fleet', 'inventory'), ('quality', 'manufacturing'), ('maintenance', 'manufacturing'), ('plm', 'manufacturing'), ('iot', 'manufacturing'), ('employees', 'hrm'), ('attendance', 'hrm'), ('payroll', 'hrm'), ('recruitment', 'hrm'), ('appraisals', 'hrm'), ('planning', 'hrm'), ('timesheets', 'projects'), ('helpdesk', 'service'), ('live_chat', 'service'), ('field_service', 'service'), ('appointments', 'service'), ('sign', 'contracts'), ('blog', 'website'), ('forum', 'website'), ('elearning', 'website'), ('knowledge', 'workplace'), ('spreadsheets', 'workplace'), ('analytics', 'ai'), ('voip', 'callcentre')) as s(old, suite)
where tm.module_key = s.old
  and not exists (select 1 from public.tenant_modules x where x.tenant_id = tm.tenant_id and x.module_key = s.suite);
delete from public.tenant_modules where module_key not in ('books', 'finance_plus', 'expense', 'crm', 'marketing', 'commerce', 'inventory', 'manufacturing', 'hrm', 'projects', 'service', 'contracts', 'callcentre', 'website', 'workplace', 'ai', 'studio');
update public.plans set included_modules = array(select distinct public.module_of(k) from unnest(included_modules) k) where included_modules <> '{}';
delete from public.platform_modules where key not in ('books', 'finance_plus', 'expense', 'crm', 'marketing', 'commerce', 'inventory', 'manufacturing', 'hrm', 'projects', 'service', 'contracts', 'callcentre', 'website', 'workplace', 'ai', 'studio');

update public.plans set description = 'Every JMSURF DASH suite for one price.' where name = 'All-in-One';
