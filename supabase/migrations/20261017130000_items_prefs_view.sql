-- Staff need the Items preferences (stock checks on documents) but not the rest of
-- erp_settings: expose only that part through the safe view.
do $$
declare d text := pg_get_viewdef('public.business_settings_safe'::regclass);
begin
  if d !~ 'items_prefs' then
    d := regexp_replace(d, 'bs\.sells\s+FROM \(business_settings bs', 'bs.sells, (bs.erp_settings -> ''items''::text) AS items_prefs FROM (business_settings bs');
    execute 'create or replace view public.business_settings_safe with (security_barrier = true) as ' || rtrim(d, '; ');
  end if;
end $$;
