-- Company contact details printed on every document (which, what and in what order),
-- VAT settings (rates, registration, withholding VAT) and withholding VAT per contact.
alter table public.business_settings add column if not exists doc_contact jsonb;
alter table public.business_settings add column if not exists tax_settings jsonb;
alter table public.customers add column if not exists withholding_vat boolean not null default false;
alter table public.suppliers add column if not exists withholding_vat boolean not null default false;

-- Staff read them through the safe view (appended after theme).
do $$
declare d text := pg_get_viewdef('public.business_settings_safe'::regclass);
begin
  if d !~ 'bs\.tax_settings' then
    d := regexp_replace(d, 'bs\.theme\s+FROM \(business_settings bs', 'bs.theme, bs.doc_contact, bs.tax_settings FROM (business_settings bs');
    execute 'create or replace view public.business_settings_safe with (security_barrier = true) as ' || rtrim(d, '; ');
  end if;
end $$;
