-- What the company sells: goods, services or both. Services-only companies do not
-- see stock screens (stock on hand, receiving, adjustments, packages).
alter table public.business_settings add column if not exists sells text;
do $$ begin
  alter table public.business_settings add constraint business_settings_sells_check check (sells is null or sells in ('goods', 'services', 'both'));
exception when duplicate_object then null; end $$;
do $$
declare d text := pg_get_viewdef('public.business_settings_safe'::regclass);
begin
  if d !~ 'bs\.sells' then
    d := regexp_replace(d, 'bs\.tax_settings\s+FROM \(business_settings bs', 'bs.tax_settings, bs.sells FROM (business_settings bs');
    execute 'create or replace view public.business_settings_safe with (security_barrier = true) as ' || rtrim(d, '; ');
  end if;
end $$;
