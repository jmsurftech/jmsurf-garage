-- JMSURF SIGN: the public signing page (/sign/<request id>) reads and signs a
-- request through these two functions only. The request id is a random UUID
-- that only the people it was sent to know.
create or replace function public.sign_request_public(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'number', r.number, 'title', r.title, 'stage', r.stage,
    'body', r.data->>'body', 'message', r.data->>'message', 'due_date', r.due_date,
    'signers', coalesce((select jsonb_agg(jsonb_build_object('name', s->>'name', 'signed_at', s->>'signed_at')) from jsonb_array_elements(coalesce(r.data->'signers', '[]'::jsonb)) s), '[]'::jsonb),
    'signatures', coalesce((select jsonb_agg(jsonb_build_object('name', s->>'name', 'signed_at', s->>'signed_at')) from jsonb_array_elements(coalesce(r.data->'signatures', '[]'::jsonb)) s), '[]'::jsonb),
    'company', t.business_name, 'logo_url', t.logo_url
  )
  from public.app_records r join public.tenants t on t.id = r.tenant_id
  where r.id = p_id and r.app = 'sign' and r.kind = 'request' and not r.archived
    and r.stage in ('sent', 'partially', 'signed')
$$;
grant execute on function public.sign_request_public(uuid) to anon, authenticated;

create or replace function public.sign_request_submit(p_id uuid, p_name text, p_signature text, p_decline boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.app_records; v_sigs jsonb; v_signers int; v_count int;
begin
  select * into r from public.app_records where id = p_id and app = 'sign' and kind = 'request' and not archived for update;
  if r.id is null or r.stage not in ('sent', 'partially') then raise exception 'This document is not open for signing'; end if;
  if r.due_date is not null and r.due_date < current_date then
    update public.app_records set stage = 'expired' where id = r.id;
    raise exception 'This signing request has expired';
  end if;
  if length(coalesce(trim(p_name), '')) < 2 then raise exception 'Type your full name'; end if;
  if p_decline then
    update public.app_records set stage = 'declined' where id = r.id;
    insert into public.app_record_events (tenant_id, record_id, kind, body) values (r.tenant_id, r.id, 'system', left(trim(p_name), 120) || ' declined to sign');
    return jsonb_build_object('stage', 'declined');
  end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature) > 400000 then raise exception 'Draw your signature'; end if;
  v_sigs := coalesce(r.data->'signatures', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'name', left(trim(p_name), 120), 'signature', p_signature, 'signed_at', now(),
    'ip', coalesce(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', '')));
  v_signers := greatest(1, jsonb_array_length(coalesce(r.data->'signers', '[]'::jsonb)));
  v_count := jsonb_array_length(v_sigs);
  update public.app_records set
    data = data || jsonb_build_object('signatures', v_sigs, 'signature', p_signature),
    stage = case when v_count >= v_signers then 'signed' else 'partially' end
  where id = r.id;
  insert into public.app_record_events (tenant_id, record_id, kind, body)
  values (r.tenant_id, r.id, 'system', left(trim(p_name), 120) || ' signed the document');
  return jsonb_build_object('stage', case when v_count >= v_signers then 'signed' else 'partially' end);
end $$;
grant execute on function public.sign_request_submit(uuid, text, text, boolean) to anon, authenticated;
