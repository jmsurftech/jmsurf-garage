-- JMSURF DASH: remove everything that came over from the template clone.
-- This database only ever held that one cloned company, so business tables are
-- emptied outright; platform configuration and generic lookups are kept.
do $$
declare
  _keep text[] := array[
    'tenants', 'profiles', 'user_roles', 'subscriptions', 'plans', 'platform_settings',
    'platform_modules', 'tenant_modules', 'tenant_members', 'platform_admins',
    'business_settings', 'locations', 'role_permissions', 'cms_content',
    'hr_leave_types', 'hr_holidays', 'crm_stages', 'crm_lost_reasons', 'crm_activity_types', 'crm_teams', 'crm_tags',
    'expense_categories', 'bill_categories', 'product_units', 'hr_departments', 'hr_designations',
    'uptime_checks', 'app_records', 'app_record_events', 'app_sequences', 'app_definitions',
    'user_ui_preferences', 'tenant_themes', 'inventory_settings', 'user_locations', 'doc_sequences'
  ];
  _t text;
  _list text := '';
begin
  for _t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not (c.relname = any (_keep))
    order by c.relname
  loop
    _list := _list || case when _list = '' then '' else ', ' end || format('public.%I', _t);
  end loop;
  execute 'truncate ' || _list || ' restart identity cascade';
end $$;

-- Kept tables must still be there (a cascade must not have reached them).
do $$ begin
  if (select count(*) from public.profiles) = 0 or (select count(*) from public.tenants) = 0 or (select count(*) from public.business_settings) = 0 then
    raise exception 'clean-up reached a kept table';
  end if;
end $$;

-- The owner's own company.
update public.tenants set
  business_name = 'JMSURF Technologies', slug = 'jmsurf', logo_url = null, industry = 'Technology',
  business_type = 'general', business_phone = null, business_address = null, updated_at = now()
where id = 'ec3d1fef-6e2b-4b60-b8f5-5275aaf2b8b7';

update public.business_settings set
  business_name = 'JMSURF Technologies', business_phone = null, business_address = null, business_website = 'https://jmsurfdash.co.ke',
  receipt_footer = '', receipt_header = '', receipt_terms = null, quote_terms = null, quote_notes = null,
  invoice_terms = null, invoice_notes = null, bank_details = null, postal_address = null,
  mpesa_shortcode = null, mpesa_till_number = null, mpesa_account_reference = null, mpesa_consumer_key = null,
  mpesa_consumer_secret = null, mpesa_passkey = null, paystack_public_key = null, paystack_secret_key = null,
  payhero_api_username = null, payhero_api_password = null, payhero_channel_id = null,
  erp_settings = '{}'::jsonb, currency = 'KES', country = 'KE', updated_at = now()
where tenant_id = 'ec3d1fef-6e2b-4b60-b8f5-5275aaf2b8b7';

update public.doc_sequences set next_value = 1;
delete from public.expense_categories where name in ('items', 'Others');
update public.hr_departments set name = 'Operations' where name = 'Grooming & care';
update public.hr_departments set name = 'Customer service' where name = 'Shop floor';
delete from public.crm_tags;
insert into public.crm_tags (tenant_id, name)
select 'ec3d1fef-6e2b-4b60-b8f5-5275aaf2b8b7', t from unnest(array['Hot', 'Warm', 'Cold', 'Referral', 'Partner', 'VIP', 'Wholesale', 'Government', 'NGO']) t;

-- The owner runs the platform and has every module in their own company.
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = 'jmsurftech@gmail.com' on conflict do nothing;
update public.subscriptions set
  plan_id = (select id from public.plans where name = 'All-in-One' and is_active limit 1), plan_name = 'All-in-One',
  status = 'active', price = 0, max_users = 1000, max_locations = 100, trial_ends_at = null,
  current_period_start = now(), current_period_end = '2126-01-01', suspended_at = null, paused_at = null
where tenant_id = 'ec3d1fef-6e2b-4b60-b8f5-5275aaf2b8b7';

update public.platform_settings set value = value || '{"business_name": "JMSURF DASH", "trial_days": 14}'::jsonb where key = 'general';

-- Product photos and old backups of the clone are removed through the Storage API (not SQL).
