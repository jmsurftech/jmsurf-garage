-- Contracts: drafted from templates or uploaded, edited with versions, signed by us
-- (Sign & Stamp) and by the other party from a private link (sign on screen, ask for
-- changes, or print, sign and upload), lawyer review, breaches and amendments,
-- linked invoices / bills / expenses, and expiry and renewal tracking.

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  number text,
  title text not null,
  type text not null default 'service',          -- nda, service, supply, consultancy, employment, sla, lease, sales, partnership, agency, licence, maintenance, other
  area text not null default 'general',          -- it, construction, healthcare, finance …
  party_kind text not null default 'customer' check (party_kind in ('customer', 'supplier', 'employee', 'other')),
  party_id uuid,
  party_name text,
  party_contact text,                             -- person who signs for the party
  party_email text,
  party_phone text,
  party_address text,
  party_pin text,
  value numeric not null default 0,
  currency text not null default 'KES',
  start_date date,
  end_date date,
  renewal text not null default 'notify' check (renewal in ('none', 'notify', 'auto')),
  notice_days int not null default 30,
  status text not null default 'draft' check (status in ('draft', 'review', 'sent', 'amend_requested', 'signed', 'active', 'expired', 'terminated')),
  source text not null default 'drafted' check (source in ('drafted', 'uploaded')),
  body text not null default '',
  version int not null default 1,
  file_path text,                                 -- uploaded contract (source = uploaded)
  share_token uuid not null default gen_random_uuid(),
  review_token uuid not null default gen_random_uuid(),
  lawyer_name text,
  lawyer_email text,
  lawyer_status text check (lawyer_status in ('pending', 'approved', 'changes')),
  sent_at timestamptz,
  viewed_at timestamptz,
  party_signed_at timestamptz,
  party_signer_name text,
  party_signer_title text,
  party_signature text,                           -- drawn signature (PNG data URL)
  party_upload_path text,                         -- signed copy the party uploaded
  terminated_at timestamptz,
  termination_reason text,
  reminded jsonb not null default '[]',           -- expiry reminders already sent ("30", "7", "1", "0")
  parent_id uuid references public.contracts(id) on delete set null, -- amendment / renewal of
  owner_id uuid default auth.uid(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contracts_share_idx on public.contracts (share_token);
create unique index if not exists contracts_review_idx on public.contracts (review_token);
create index if not exists contracts_tenant_idx on public.contracts (tenant_id, status, end_date);
create index if not exists contracts_party_idx on public.contracts (tenant_id, party_kind, party_id);

create or replace function public.contracts_number() returns trigger language plpgsql as $$
declare n int;
begin
  if new.number is null or new.number = '' then
    select coalesce(max(nullif(regexp_replace(number, '\D', '', 'g'), '')::int), 0) + 1 into n from public.contracts where tenant_id = new.tenant_id;
    new.number := 'CT-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists contracts_number_trg on public.contracts;
create trigger contracts_number_trg before insert on public.contracts for each row execute function public.contracts_number();

create table if not exists public.contract_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  version int not null,
  body text not null,
  note text,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists contract_versions_idx on public.contract_versions (contract_id, version desc);

create table if not exists public.contract_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  kind text not null,                             -- created, edited, sent, viewed, signed_us, signed_party, uploaded, amend_request, lawyer_sent, lawyer_comment, lawyer_approved, breach, resolved, linked, renewed, expired, terminated, reminder, note
  actor text,
  body text,
  created_at timestamptz not null default now()
);
create index if not exists contract_events_idx on public.contract_events (contract_id, created_at desc);

-- Breaches, change requests (from the party or us) and lawyer review comments.
create table if not exists public.contract_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  kind text not null check (kind in ('breach', 'amendment', 'review')),
  side text not null default 'us' check (side in ('us', 'party', 'lawyer')),
  status text not null default 'open' check (status in ('open', 'resolved', 'accepted', 'declined')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  title text,
  details text,
  clause text,
  remedy_due date,
  resolution text,
  raised_by_name text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists contract_issues_idx on public.contract_issues (contract_id, created_at desc);

-- Invoices, bills, expenses and orders raised under a contract (e.g. a tender supply).
create table if not exists public.contract_links (
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  entity_type text not null check (entity_type in ('invoice', 'bill', 'expense', 'purchase_order', 'quote', 'sales_order')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (contract_id, entity_type, entity_id)
);

do $$
declare t text;
begin
  foreach t in array array['contracts', 'contract_versions', 'contract_events', 'contract_issues', 'contract_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant', t);
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id())', t || '_tenant', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ public link

/** Who to tell about a contract: its owner, else the admins. */
create or replace function public.contract_notify(c public.contracts, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.shop_notifications (tenant_id, kind, title, body, link, user_id, role, entity_type, entity_id)
    values (c.tenant_id, 'contract', p_title, p_body, '/contracts/' || c.id, c.owner_id, case when c.owner_id is null then 'admin' end, 'contract', c.id);
end $$;
revoke all on function public.contract_notify(public.contracts, text, text) from public, anon, authenticated;

/** The contract as the other party (share link) or the lawyer (review link) sees it. */
create or replace function public.contract_public(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contracts; role text; t record; us record;
begin
  select * into c from public.contracts where share_token = p_token;
  if found then role := 'party';
  else
    select * into c from public.contracts where review_token = p_token;
    if not found then return null; end if;
    role := 'lawyer';
  end if;
  if c.status in ('draft') and role = 'party' then return null; end if;
  select business_name, logo_url, business_email, business_phone, business_address into t from public.tenants where id = c.tenant_id;
  select signed_by_name, signed_at into us from public.signature_requests where doc_type = 'contract' and doc_id = c.id and status = 'signed' order by signed_at desc limit 1;
  if role = 'party' and c.viewed_at is null then
    update public.contracts set viewed_at = now() where id = c.id;
    insert into public.contract_events (tenant_id, contract_id, kind, actor, body) values (c.tenant_id, c.id, 'viewed', c.party_name, 'Opened the contract link');
  end if;
  return jsonb_build_object(
    'role', role, 'id', c.id, 'number', c.number, 'title', c.title, 'type', c.type, 'status', c.status, 'body', c.body, 'version', c.version,
    'party_name', c.party_name, 'party_kind', c.party_kind, 'party_contact', c.party_contact, 'value', c.value, 'currency', c.currency, 'start_date', c.start_date, 'end_date', c.end_date,
    'source', c.source, 'has_file', c.file_path is not null,
    'party_signed_at', c.party_signed_at, 'party_signer_name', c.party_signer_name, 'party_signer_title', c.party_signer_title, 'party_signature', c.party_signature,
    'party_uploaded', c.party_upload_path is not null, 'lawyer_name', c.lawyer_name, 'lawyer_status', c.lawyer_status,
    'company', jsonb_build_object('name', t.business_name, 'logo_url', t.logo_url, 'email', t.business_email, 'phone', t.business_phone, 'address', t.business_address),
    'our_signed_by', us.signed_by_name, 'our_signed_at', us.signed_at,
    'issues', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'side', i.side, 'status', i.status, 'title', i.title, 'details', i.details, 'clause', i.clause, 'resolution', i.resolution, 'created_at', i.created_at) order by i.created_at desc)
      from public.contract_issues i where i.contract_id = c.id and i.kind <> 'breach' and (role = 'lawyer' or i.side = 'party')), '[]'::jsonb)
  );
end $$;
grant execute on function public.contract_public(uuid) to anon, authenticated;

/** The other party signs on screen. */
create or replace function public.contract_public_sign(p_token uuid, p_name text, p_title text, p_signature text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contracts; st text;
begin
  select * into c from public.contracts where share_token = p_token for update;
  if not found then raise exception 'This link is not valid'; end if;
  if c.status not in ('sent', 'amend_requested') then raise exception 'This contract cannot be signed now (it is %)', c.status; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Type your full name'; end if;
  if coalesce(p_signature, '') !~ '^data:image/png;base64,' or length(p_signature) > 600000 then raise exception 'Draw your signature'; end if;
  st := case when c.start_date is not null and c.start_date > current_date then 'signed' else 'active' end;
  update public.contracts set status = st, party_signed_at = now(), party_signer_name = trim(p_name), party_signer_title = nullif(trim(p_title), ''), party_signature = p_signature, updated_at = now() where id = c.id;
  insert into public.contract_events (tenant_id, contract_id, kind, actor, body) values (c.tenant_id, c.id, 'signed_party', trim(p_name), 'Signed on screen from the contract link');
  perform public.contract_notify(c, concat(c.number, ' signed by ', coalesce(c.party_name, 'the other party')), concat(trim(p_name), ' signed ', c.title, '.'));
  return jsonb_build_object('status', st);
end $$;
grant execute on function public.contract_public_sign(uuid, text, text, text) to anon, authenticated;

/** The other party asks for changes, or the lawyer comments / approves. */
create or replace function public.contract_public_feedback(p_token uuid, p_name text, p_details text, p_clause text default null, p_approve boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contracts; role text;
begin
  select * into c from public.contracts where share_token = p_token for update;
  if found then role := 'party';
  else
    select * into c from public.contracts where review_token = p_token for update;
    if not found then raise exception 'This link is not valid'; end if;
    role := 'lawyer';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Type your name'; end if;
  if role = 'party' then
    if c.status not in ('sent', 'amend_requested') then raise exception 'Changes can only be asked for before signing'; end if;
    if coalesce(trim(p_details), '') = '' then raise exception 'Say what should change'; end if;
    insert into public.contract_issues (tenant_id, contract_id, kind, side, title, details, clause, raised_by_name)
      values (c.tenant_id, c.id, 'amendment', 'party', 'Change requested', trim(p_details), nullif(trim(p_clause), ''), trim(p_name));
    update public.contracts set status = 'amend_requested', updated_at = now() where id = c.id;
    insert into public.contract_events (tenant_id, contract_id, kind, actor, body) values (c.tenant_id, c.id, 'amend_request', trim(p_name), trim(p_details));
    perform public.contract_notify(c, concat(c.number, ': changes requested'), concat(trim(p_name), ' asked for changes: ', left(trim(p_details), 180)));
  else
    if p_approve then
      update public.contracts set lawyer_status = 'approved', updated_at = now() where id = c.id;
      insert into public.contract_events (tenant_id, contract_id, kind, actor, body) values (c.tenant_id, c.id, 'lawyer_approved', trim(p_name), coalesce(nullif(trim(p_details), ''), 'Approved the contract'));
      perform public.contract_notify(c, concat(c.number, ' approved by your lawyer'), concat(trim(p_name), ' approved ', c.title, '.'));
    else
      if coalesce(trim(p_details), '') = '' then raise exception 'Write your comment'; end if;
      insert into public.contract_issues (tenant_id, contract_id, kind, side, title, details, clause, raised_by_name)
        values (c.tenant_id, c.id, 'review', 'lawyer', 'Lawyer comment', trim(p_details), nullif(trim(p_clause), ''), trim(p_name));
      update public.contracts set lawyer_status = 'changes', updated_at = now() where id = c.id;
      insert into public.contract_events (tenant_id, contract_id, kind, actor, body) values (c.tenant_id, c.id, 'lawyer_comment', trim(p_name), trim(p_details));
      perform public.contract_notify(c, concat(c.number, ': lawyer comment'), concat(trim(p_name), ': ', left(trim(p_details), 180)));
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.contract_public_feedback(uuid, text, text, text, boolean) to anon, authenticated;

-- When the text last changed (a signature from before then must be given again).
alter table public.contracts add column if not exists edited_at timestamptz;
