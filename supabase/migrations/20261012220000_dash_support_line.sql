-- JMSURF support line: the platform owner's own company runs the support call
-- centre. Companies call it from DASH or ask for a call back; the owner takes the
-- calls in the super admin (phone dock) and sees who is calling.

/** The company whose call centre answers JMSURF support (the platform owner's company). */
create or replace function public.platform_support_tenant() returns uuid
language sql stable security definer set search_path = public as $$
  select p.tenant_id from public.platform_admins a join public.profiles p on p.user_id = a.user_id
  where p.tenant_id is not null order by a.created_at limit 1
$$;

/** The number companies call for support (the support call centre's line, if connected). */
create or replace function public.support_line() returns text
language sql stable security definer set search_path = public as $$
  select at_number from public.cc_settings where tenant_id = public.platform_support_tenant() and enabled
$$;
grant execute on function public.support_line() to authenticated, anon;

/** A company asks JMSURF support to call them back. */
create or replace function public.request_support_callback(p_phone text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare st uuid := public.platform_support_tenant(); me text; co text; ph text := nullif(trim(p_phone), '');
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if st is null then raise exception 'Support is not set up yet'; end if;
  if ph is null or length(regexp_replace(ph, '\D', '', 'g')) < 9 then raise exception 'Enter the number we should call'; end if;
  select display_name into me from public.profiles where user_id = auth.uid();
  select business_name into co from public.tenants where id = public.current_user_tenant_id();
  if exists (select 1 from public.cc_callbacks where tenant_id = st and phone = ph and status = 'open' and created_at > now() - interval '2 hours') then return; end if;
  insert into public.cc_callbacks (tenant_id, phone, customer_name, status, notes)
  values (st, ph, concat_ws(' · ', co, me), 'open', left(coalesce(p_note, ''), 1000));
  insert into public.platform_alert_queue (event, title, body, link)
  values ('inquiry', 'Call back requested: ' || coalesce(co, me, ph), concat_ws(' · ', me, ph, left(p_note, 200)), '/admin/support');
end $$;
grant execute on function public.request_support_callback(text, text) to authenticated;

/** Who these numbers belong to (companies and their people), for the support call list. */
create or replace function public.support_caller_lookup(p_phones text[])
returns table (phone text, company text, slug text, person text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  return query
  with n as (select x as phone, right(regexp_replace(x, '\D', '', 'g'), 9) as tail from unnest(p_phones) x)
  select n.phone,
    coalesce(t1.business_name, t2.business_name),
    coalesce(t1.slug, t2.slug),
    p.display_name
  from n
  left join lateral (select business_name, slug from public.tenants where right(regexp_replace(coalesce(contact_phone, business_phone, ''), '\D', '', 'g'), 9) = n.tail limit 1) t1 on true
  left join lateral (select pr.display_name, pr.tenant_id from public.profiles pr where right(regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g'), 9) = n.tail limit 1) p on true
  left join public.tenants t2 on t2.id = p.tenant_id;
end $$;
grant execute on function public.support_caller_lookup(text[]) to authenticated;

/** Recent support calls and call-back requests (Admin → Support calls). */
create or replace function public.support_activity() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st uuid := public.platform_support_tenant();
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  return jsonb_build_object(
    'line', (select at_number from public.cc_settings where tenant_id = st),
    'calls', coalesce((select jsonb_agg(c order by c.started_at desc) from (select id, direction, from_number, to_number, status, started_at, duration_seconds, recording_url, notes from public.cc_calls where tenant_id = st order by started_at desc limit 100) c), '[]'::jsonb),
    'callbacks', coalesce((select jsonb_agg(b order by b.created_at desc) from (select id, phone, customer_name, status, notes, created_at, done_at from public.cc_callbacks where tenant_id = st order by created_at desc limit 100) b), '[]'::jsonb)
  );
end $$;
grant execute on function public.support_activity() to authenticated;

create or replace function public.support_callback_done(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  update public.cc_callbacks set status = 'done', done_at = now() where id = p_id and tenant_id = public.platform_support_tenant();
end $$;
grant execute on function public.support_callback_done(uuid) to authenticated;
