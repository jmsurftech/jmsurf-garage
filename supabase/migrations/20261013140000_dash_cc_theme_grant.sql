-- Companies read their own theme (cc_settings has column-level SELECT grants; callback_key stays hidden).
grant select (theme) on public.cc_settings to authenticated;
