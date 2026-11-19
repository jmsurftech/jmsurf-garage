-- The company's colour theme (chosen in Settings → Appearance by an admin): every staff
-- member's screen, the logo mark and all documents follow it.
alter table public.business_settings add column if not exists theme jsonb;

-- Staff read settings through the safe view: add the theme as its last column
-- (just before the view's own "FROM (business_settings bs").
do $$
declare d text := pg_get_viewdef('public.business_settings_safe'::regclass);
begin
  -- (repairs an earlier attempt that put it inside a sub-query)
  d := regexp_replace(d, 'SELECT 1,\s*bs\.theme,\s*bs\.theme\s*FROM', 'SELECT 1 FROM');
  d := regexp_replace(d, 'SELECT 1,\s*bs\.theme\s*FROM', 'SELECT 1 FROM');
  if d !~ 'bs\.theme\s*FROM \(business_settings bs' then
    d := regexp_replace(d, '\s+FROM \(business_settings bs', ', bs.theme FROM (business_settings bs');
  end if;
  execute 'create or replace view public.business_settings_safe with (security_barrier = true) as ' || rtrim(d, '; ');
end $$;
