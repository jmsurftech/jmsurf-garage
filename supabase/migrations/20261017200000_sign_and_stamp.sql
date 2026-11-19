-- Sign & Stamp: each signer's e-signature and stamp, and signing requests for
-- documents that must be signed (optionally reviewed and approved by the signer).

create table if not exists public.user_signatures (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  full_name text,
  title text,                      -- e.g. Director, Finance Manager
  signature_path text,             -- storage "documents": <tenant>/signatures/<user>/signature-….png
  stamp_path text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
alter table public.user_signatures enable row level security;
drop policy if exists user_signatures_read on public.user_signatures;
create policy user_signatures_read on public.user_signatures for select to authenticated using (tenant_id = public.current_user_tenant_id());
drop policy if exists user_signatures_write on public.user_signatures;
create policy user_signatures_write on public.user_signatures for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and (user_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id() and (user_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));
grant select, insert, update, delete on public.user_signatures to authenticated;

create table if not exists public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  doc_type text not null,
  doc_id uuid not null,
  doc_number text,
  title text,
  amount numeric,
  signers uuid[] not null default '{}',
  with_approval boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'signed', 'rejected', 'cancelled')),
  requested_by uuid default auth.uid(),
  requested_by_name text,
  signed_by uuid,
  signed_by_name text,
  signed_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists signature_requests_doc_idx on public.signature_requests (doc_type, doc_id, created_at desc);
create index if not exists signature_requests_open_idx on public.signature_requests (tenant_id, status, created_at desc);
alter table public.signature_requests enable row level security;
drop policy if exists signature_requests_read on public.signature_requests;
create policy signature_requests_read on public.signature_requests for select to authenticated using (tenant_id = public.current_user_tenant_id());
grant select on public.signature_requests to authenticated;

/** Sends a document to its signers (from System → Approvals → signing rules). */
create or replace function public.submit_for_signing(p_type text, p_doc uuid, p_number text, p_title text, p_amount numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_user_tenant_id();
  rule jsonb; signers uuid[]; rid uuid; who text;
begin
  if t is null then raise exception 'No company for this account'; end if;
  select erp_settings -> 'signing' -> p_type into rule from public.business_settings where tenant_id = t limit 1;
  if rule is null or coalesce((rule ->> 'enabled')::boolean, false) = false then raise exception 'This document type does not need signing'; end if;
  select array_agg(x::uuid) into signers from jsonb_array_elements_text(coalesce(rule -> 'signers', '[]'::jsonb)) x;
  if coalesce(array_length(signers, 1), 0) = 0 then raise exception 'Choose who signs % in System → Approvals', p_type; end if;
  update public.signature_requests set status = 'cancelled' where tenant_id = t and doc_type = p_type and doc_id = p_doc and status = 'pending';
  select display_name into who from public.profiles where user_id = auth.uid();
  insert into public.signature_requests (tenant_id, doc_type, doc_id, doc_number, title, amount, signers, with_approval, requested_by_name)
    values (t, p_type, p_doc, p_number, p_title, p_amount, signers, coalesce((rule ->> 'with_approval')::boolean, false), who)
    returning id into rid;
  insert into public.shop_notifications (tenant_id, kind, title, body, link, user_id, entity_type, entity_id)
    select t, 'signature', concat('Please sign ', coalesce(p_number, p_title)), concat(coalesce(who, 'A colleague'), ' sent ', coalesce(p_title, p_type), ' for your signature.'),
      '/approvals?tab=sign', s, p_type, p_doc from unnest(signers) s;
  return rid;
end $$;
grant execute on function public.submit_for_signing(text, uuid, text, text, numeric) to authenticated;

/** A signer signs (approving it when the rule asks for approval) or rejects with a reason. */
create or replace function public.decide_signature(p_id uuid, p_sign boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.signature_requests; who text; has_sig boolean;
begin
  select * into r from public.signature_requests where id = p_id for update;
  if not found or r.tenant_id <> public.current_user_tenant_id() then raise exception 'Signing request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request was already %', r.status; end if;
  if not (auth.uid() = any (r.signers)) then raise exception 'You are not a signer for this document'; end if;
  if p_sign then
    select signature_path is not null into has_sig from public.user_signatures where tenant_id = r.tenant_id and user_id = auth.uid();
    if not coalesce(has_sig, false) then raise exception 'Upload your signature first (System → Signatures & stamps)'; end if;
  elsif coalesce(trim(p_reason), '') = '' then raise exception 'Say why it is rejected';
  end if;
  select coalesce(us.full_name, p.display_name) into who from public.profiles p left join public.user_signatures us on us.user_id = p.user_id and us.tenant_id = r.tenant_id where p.user_id = auth.uid();
  update public.signature_requests set status = case when p_sign then 'signed' else 'rejected' end, signed_by = auth.uid(), signed_by_name = who, signed_at = now(), reason = nullif(trim(p_reason), '')
    where id = p_id;
  if r.requested_by is not null then
    insert into public.shop_notifications (tenant_id, kind, title, body, link, user_id, entity_type, entity_id)
      values (r.tenant_id, 'signature', case when p_sign then concat(coalesce(r.doc_number, r.title), ' is signed') else concat(coalesce(r.doc_number, r.title), ' was not signed') end,
        case when p_sign then concat(coalesce(who, 'The signer'), case when r.with_approval then ' approved and signed it. You can send it now.' else ' signed it. You can send it now.' end)
             else concat(coalesce(who, 'The signer'), ' rejected it: ', p_reason, '. Fix it and submit again.') end,
        null, r.requested_by, r.doc_type, r.doc_id);
  end if;
  return jsonb_build_object('status', case when p_sign then 'signed' else 'rejected' end);
end $$;
grant execute on function public.decide_signature(uuid, boolean, text) to authenticated;

-- Every staff member needs the signing rules (to know a document must be signed first).
do $$
declare d text := pg_get_viewdef('public.business_settings_safe'::regclass);
begin
  if d !~ 'signing_rules' then
    d := regexp_replace(d, 'AS items_prefs\s+FROM \(business_settings bs', 'AS items_prefs, (bs.erp_settings -> ''signing''::text) AS signing_rules FROM (business_settings bs');
    execute 'create or replace view public.business_settings_safe with (security_barrier = true) as ' || rtrim(d, '; ');
  end if;
end $$;
