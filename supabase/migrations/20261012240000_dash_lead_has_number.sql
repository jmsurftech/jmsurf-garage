-- Call centre sign-ups also say whether they already have a phone number (a sales cue).
create or replace function public.platform_lead_from_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
declare meta jsonb; product text;
begin
  select raw_user_meta_data into meta from auth.users where id = NEW.owner_user_id;
  meta := coalesce(meta, '{}'::jsonb);
  product := case when meta->>'signup_source' = 'callcentre' then 'callcentre' else 'dash' end;
  insert into public.platform_leads (name, company, email, phone, source, stage, tenant_id, product, heard_from, country, details, notes)
  values (coalesce(NEW.contact_name, NEW.business_name), NEW.business_name, coalesce(NEW.contact_email, NEW.business_email), coalesce(NEW.contact_phone, NEW.business_phone),
          'signup', 'trial', NEW.id, product, nullif(meta->>'heard_from', ''), coalesce(nullif(meta->>'country', ''), 'KE'),
          jsonb_strip_nulls(jsonb_build_object('heard_detail', meta->>'heard_detail', 'company_size', meta->>'company_size', 'industry', NEW.industry,
            'job_title', meta->>'job_title', 'agents', meta->>'agents', 'monthly_calls', meta->>'monthly_calls', 'goals', meta->'goals', 'website', meta->>'website', 'has_number', meta->>'has_number', 'country_name', meta->>'country_name')),
          'https://' || NEW.slug || '.jmsurfdash.co.ke')
  on conflict do nothing;
  insert into public.platform_alert_queue (event, title, body, link)
  values ('signup', 'New ' || case when product = 'callcentre' then 'call centre' else 'DASH' end || ' sign-up: ' || NEW.business_name,
          concat_ws(' · ', NEW.contact_name, NEW.contact_email, NEW.contact_phone, 'heard via ' || nullif(meta->>'heard_from', '')), '/admin/leads');
  return NEW;
exception when others then
  raise warning 'platform lead for tenant %: %', NEW.id, sqlerrm;
  return NEW;
end $$;
