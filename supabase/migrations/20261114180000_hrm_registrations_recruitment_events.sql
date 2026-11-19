-- HRM: staff self-registration, recruitment to hire, HR events. Re-runnable.
--
-- 1. Staff self-registration. HR makes an invite link (hr_registration_links: optional department,
--    expiry and a cap on how many people may use it). A new hire opens /join/<token> without logging in
--    and sends their personal, statutory, next-of-kin and bank / M-Pesa details through
--    hr_registration_submit() (security definer, checked against the token: active, not expired, under
--    its use cap; each use counts). It returns a one-time upload key; the files (ID copy, KRA
--    certificate…) go to /api/public/hr-registration-upload, which checks the token, the registration and
--    the key's SHA-256 (hr_registrations.upload_key_hash) and saves them to the private documents bucket
--    as documents rows (entity_type 'hr_registration'). HR approves (hr_registration_approve: creates the
--    hr_employees record and files the documents on it) or rejects with a note.
--    Anonymous users never touch the tables: only the two functions below are granted to anon.
-- 2. Recruitment to hire. Vacancies and candidates stay in the record engine (app_records, app
--    'recruitment': kind job / applicant, with stages and the activity log app_record_events).
--    hr_hire_applicant() turns a candidate into an employee (or marks an internal candidate hired), opens
--    the onboarding checklist (hr_tasks), copies the candidate's files (CV…) onto the employee and fills
--    the vacancy when all openings are taken.
-- 3. HR events planner: hr_events (training, team building, meeting, celebration, other) for everyone
--    or one department. HR manages them; staff read the ones meant for them (My Space).

-- ── 1. registration links and submissions ──────────────────────────────────
create table if not exists public.hr_registration_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  label text,
  department_id uuid references public.hr_departments(id) on delete set null,
  expires_at timestamptz,
  max_uses int not null default 25 check (max_uses between 1 and 1000),
  uses int not null default 0,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists hr_registration_links_tenant_idx on public.hr_registration_links (tenant_id, created_at desc);

create table if not exists public.hr_registrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  link_id uuid references public.hr_registration_links(id) on delete set null,
  department_id uuid references public.hr_departments(id) on delete set null,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  first_name text not null,
  last_name text not null default '',
  other_names text,
  gender text,
  date_of_birth date,
  marital_status text,
  national_id text,
  kra_pin text,
  nssf_no text,
  shif_no text,
  phone text,
  email text,
  address text,
  next_of_kin jsonb not null default '{}'::jsonb,
  payment_method text not null default 'bank',
  bank_name text,
  bank_branch text,
  bank_account text,
  mpesa_phone text,
  note text,
  upload_key_hash text,
  file_count int not null default 0,
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  employee_id uuid references public.hr_employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hr_registrations_tenant_idx on public.hr_registrations (tenant_id, status, created_at desc);

-- ── 3. HR events ────────────────────────────────────────────────────────────
create table if not exists public.hr_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  kind text not null default 'other' check (kind in ('training', 'team_building', 'meeting', 'celebration', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  venue text,
  audience text not null default 'all' check (audience in ('all', 'department')),
  department_id uuid references public.hr_departments(id) on delete set null,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_events_tenant_idx on public.hr_events (tenant_id, starts_at);

-- ── Security ────────────────────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['hr_registration_links', 'hr_registrations', 'hr_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id = public.current_user_tenant_id() and public.hr_can()) with check (tenant_id = public.current_user_tenant_id() and public.hr_can())', t || '_rw', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- Staff read the events meant for them.
drop policy if exists hr_events_staff on public.hr_events;
create policy hr_events_staff on public.hr_events for select to authenticated using (
  tenant_id = public.current_user_tenant_id() and public.hr_my_employee_id() is not null
  and (audience = 'all' or department_id = (select department_id from public.hr_employees where id = public.hr_my_employee_id())));

-- ── Public registration (anon, by token) ────────────────────────────────────
-- What the join page shows: the company and whether the link can still be used.
create or replace function public.hr_registration_link_info(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.hr_registration_links; t record; dep text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return null; end if;
  select * into l from public.hr_registration_links where token = p_token;
  if l.id is null then return null; end if;
  select business_name, logo_url into t from public.tenants where id = l.tenant_id;
  select name into dep from public.hr_departments where id = l.department_id;
  return jsonb_build_object(
    'company', t.business_name, 'logo', t.logo_url, 'department', dep,
    'open', l.active and (l.expires_at is null or l.expires_at > now()) and l.uses < l.max_uses,
    'expires_at', l.expires_at);
end $$;
revoke all on function public.hr_registration_link_info(text) from public;
grant execute on function public.hr_registration_link_info(text) to anon, authenticated;

-- A new hire sends their details. Returns the registration id and a one-time key for the file uploads.
create or replace function public.hr_registration_submit(p_token text, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  l public.hr_registration_links; rid uuid; k text;
  fn text := left(trim(coalesce(p ->> 'first_name', '')), 80);
  ln text := left(trim(coalesce(p ->> 'last_name', '')), 80);
  nid text := left(upper(regexp_replace(coalesce(p ->> 'national_id', ''), '\s', '', 'g')), 20);
  pin text := left(upper(regexp_replace(coalesce(p ->> 'kra_pin', ''), '\s', '', 'g')), 11);
  ph text := left(regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9+]', '', 'g'), 16);
  em text := left(lower(trim(coalesce(p ->> 'email', ''))), 160);
  dob date;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then raise exception 'This link is not valid'; end if;
  select * into l from public.hr_registration_links where token = p_token for update;
  if l.id is null then raise exception 'This link is not valid'; end if;
  if not l.active then raise exception 'This link has been switched off. Ask HR for a new one.'; end if;
  if l.expires_at is not null and l.expires_at <= now() then raise exception 'This link has expired. Ask HR for a new one.'; end if;
  if l.uses >= l.max_uses then raise exception 'This link has been used up. Ask HR for a new one.'; end if;
  if fn = '' or ln = '' then raise exception 'Enter your first and last name'; end if;
  if nid = '' then raise exception 'Enter your ID or passport number'; end if;
  if length(ph) < 9 then raise exception 'Enter a valid phone number'; end if;
  if pin <> '' and pin !~ '^[AP][0-9]{9}[A-Z]$' then raise exception 'The KRA PIN looks wrong. It is a letter, 9 digits and a letter (e.g. A012345678Z).'; end if;
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'The email address looks wrong'; end if;
  begin dob := nullif(p ->> 'date_of_birth', '')::date; exception when others then raise exception 'The date of birth looks wrong'; end;
  if dob is not null and (dob > current_date - interval '15 years' or dob < current_date - interval '90 years') then raise exception 'The date of birth looks wrong'; end if;
  if exists (select 1 from public.hr_employees where tenant_id = l.tenant_id and upper(national_id) = nid) then
    raise exception 'Someone with this ID number is already on the staff list. Contact HR.'; end if;
  if exists (select 1 from public.hr_registrations where tenant_id = l.tenant_id and upper(national_id) = nid and status = 'submitted') then
    raise exception 'Details for this ID number were already sent and are waiting for HR.'; end if;

  k := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.hr_registrations (tenant_id, link_id, department_id, first_name, last_name, other_names, gender, date_of_birth, marital_status,
    national_id, kra_pin, nssf_no, shif_no, phone, email, address, next_of_kin, payment_method, bank_name, bank_branch, bank_account, mpesa_phone, note, upload_key_hash)
  values (l.tenant_id, l.id, l.department_id, fn, ln, nullif(left(trim(coalesce(p ->> 'other_names', '')), 80), ''),
    nullif(left(p ->> 'gender', 20), ''), dob, nullif(left(p ->> 'marital_status', 20), ''),
    nid, nullif(pin, ''), nullif(left(trim(coalesce(p ->> 'nssf_no', '')), 30), ''), nullif(left(trim(coalesce(p ->> 'shif_no', '')), 30), ''),
    ph, nullif(em, ''), nullif(left(trim(coalesce(p ->> 'address', '')), 300), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'name', nullif(left(trim(coalesce(p ->> 'kin_name', '')), 120), ''),
      'relationship', nullif(left(trim(coalesce(p ->> 'kin_relationship', '')), 40), ''),
      'phone', nullif(left(regexp_replace(coalesce(p ->> 'kin_phone', ''), '[^0-9+]', '', 'g'), 16), ''))),
    case when p ->> 'payment_method' = 'mpesa' then 'mpesa' else 'bank' end,
    nullif(left(trim(coalesce(p ->> 'bank_name', '')), 80), ''), nullif(left(trim(coalesce(p ->> 'bank_branch', '')), 80), ''),
    nullif(left(regexp_replace(coalesce(p ->> 'bank_account', ''), '\s', '', 'g'), 30), ''),
    nullif(left(regexp_replace(coalesce(p ->> 'mpesa_phone', ''), '[^0-9+]', '', 'g'), 16), ''),
    nullif(left(trim(coalesce(p ->> 'note', '')), 1000), ''),
    encode(sha256(convert_to(k, 'UTF8')), 'hex'))
  returning id into rid;
  update public.hr_registration_links set uses = uses + 1 where id = l.id;
  insert into public.shop_notifications (tenant_id, kind, title, body, link, role)
  values (l.tenant_id, 'hrm', 'New staff registration', fn || ' ' || ln || ' sent their details. Review them in HRM → Registrations.', '/hrm/registrations', 'admin');
  return jsonb_build_object('id', rid, 'key', k);
end $$;
revoke all on function public.hr_registration_submit(text, jsonb) from public;
grant execute on function public.hr_registration_submit(text, jsonb) to anon, authenticated;

-- ── HR decisions ────────────────────────────────────────────────────────────
-- Approve: create the employee from the registration (HR may set the job details) and file the documents on it.
create or replace function public.hr_registration_approve(p_id uuid, p jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.hr_registrations; eid uuid; nm text;
begin
  if not public.hr_can() then raise exception 'Not allowed'; end if;
  select * into r from public.hr_registrations where id = p_id and tenant_id = public.current_user_tenant_id() for update;
  if r.id is null then raise exception 'Not found'; end if;
  if r.status <> 'submitted' then raise exception 'Already decided'; end if;
  if exists (select 1 from public.hr_employees where tenant_id = r.tenant_id and upper(national_id) = upper(r.national_id)) then
    raise exception 'An employee with ID number % already exists', r.national_id; end if;
  insert into public.hr_employees (tenant_id, employee_no, first_name, last_name, other_names, gender, date_of_birth, marital_status, national_id, kra_pin, nssf_no, shif_no,
    phone, email, address, next_of_kin, department_id, designation_id, employment_type, hire_date, status, payment_method, bank_name, bank_branch, bank_account, mpesa_phone)
  values (r.tenant_id, nullif(trim(coalesce(p ->> 'employee_no', '')), ''), r.first_name, r.last_name, r.other_names, r.gender, r.date_of_birth, r.marital_status, r.national_id, r.kra_pin, r.nssf_no, r.shif_no,
    r.phone, r.email, r.address, r.next_of_kin,
    coalesce(nullif(p ->> 'department_id', '')::uuid, r.department_id), nullif(p ->> 'designation_id', '')::uuid,
    coalesce(nullif(p ->> 'employment_type', ''), 'permanent'), coalesce(nullif(p ->> 'hire_date', '')::date, current_date),
    case when p ->> 'employment_type' = 'probation' then 'probation' else 'active' end,
    r.payment_method, r.bank_name, r.bank_branch, r.bank_account, r.mpesa_phone)
  returning id into eid;
  nm := trim(r.first_name || ' ' || coalesce(r.other_names || ' ', '') || r.last_name);
  update public.documents set entity_type = 'employee', entity_id = eid, entity_name = nm
   where tenant_id = r.tenant_id and entity_type = 'hr_registration' and entity_id = r.id;
  update public.hr_registrations set status = 'approved', employee_id = eid, review_note = nullif(trim(coalesce(p ->> 'note', '')), ''),
    reviewed_by = auth.uid(), reviewed_at = now(), upload_key_hash = null where id = r.id;
  return eid;
end $$;
revoke all on function public.hr_registration_approve(uuid, jsonb) from public, anon;
grant execute on function public.hr_registration_approve(uuid, jsonb) to authenticated;

create or replace function public.hr_registration_reject(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.hr_can() then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say why it is rejected'; end if;
  update public.hr_registrations set status = 'rejected', review_note = trim(p_note), reviewed_by = auth.uid(), reviewed_at = now(), upload_key_hash = null
   where id = p_id and tenant_id = public.current_user_tenant_id() and status = 'submitted';
  if not found then raise exception 'Not found or already decided'; end if;
end $$;
revoke all on function public.hr_registration_reject(uuid, text) from public, anon;
grant execute on function public.hr_registration_reject(uuid, text) to authenticated;

-- ── 2. Recruitment: hire a candidate ────────────────────────────────────────
create or replace function public.hr_hire_applicant(p_record uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.app_records; j public.app_records; eid uuid; fname text; rest text; dep uuid; typ text; hired int; nm text;
  steps text[] := array['Signed contract of employment', 'Copy of national ID / passport', 'KRA PIN certificate', 'NSSF number', 'SHA (SHIF) number',
    'Bank or M-Pesa details', 'Next of kin details', 'Login created in JMSURF DASH', 'Equipment, uniform and keys issued', 'Policies read and acknowledged', 'Introduced to the team'];
begin
  if not public.hr_can() then raise exception 'Not allowed'; end if;
  select * into a from public.app_records where id = p_record and tenant_id = public.current_user_tenant_id() and app = 'recruitment' and kind = 'applicant' for update;
  if a.id is null then raise exception 'Candidate not found'; end if;
  if a.stage = 'hired' then raise exception 'This candidate is already hired'; end if;
  select * into j from public.app_records where id = a.parent_id and tenant_id = a.tenant_id;

  if a.employee_id is not null and exists (select 1 from public.hr_employees where id = a.employee_id and tenant_id = a.tenant_id) then
    -- Internal candidate: already an employee (record the move under Promotions & Transfers).
    eid := a.employee_id;
  else
    nm := regexp_replace(trim(coalesce(a.title, '')), '\s+', ' ', 'g');
    if nm = '' then raise exception 'The candidate has no name'; end if;
    fname := split_part(nm, ' ', 1);
    rest := nullif(trim(substr(nm, length(fname) + 1)), '');
    select id into dep from public.hr_departments where tenant_id = a.tenant_id and lower(name) = lower(trim(coalesce(j.data ->> 'department', ''))) limit 1;
    typ := case j.data ->> 'type' when 'Contract' then 'contract' when 'Internship' then 'intern' when 'Casual' then 'casual' else 'permanent' end;
    insert into public.hr_employees (tenant_id, first_name, last_name, email, phone, department_id, employment_type, hire_date, status, basic_salary)
    values (a.tenant_id, fname, coalesce(rest, ''), nullif(a.data ->> 'email', ''), nullif(a.data ->> 'phone', ''), dep, typ, current_date, 'active', coalesce(a.amount, 0))
    returning id into eid;
    insert into public.hr_tasks (tenant_id, employee_id, kind, title, sort)
    select a.tenant_id, eid, 'onboarding', s.t, s.i from unnest(steps) with ordinality as s(t, i);
    -- The candidate's files (CV, certificates…) are copied onto the employee.
    insert into public.documents (tenant_id, entity_type, entity_id, entity_name, name, category, path, url, mime_type, size_bytes, expires_on, notes, uploaded_by, uploaded_by_name)
    select tenant_id, 'employee', eid, nm, name, coalesce(category, 'Recruitment'), path, url, mime_type, size_bytes, expires_on, notes, uploaded_by, uploaded_by_name
      from public.documents where tenant_id = a.tenant_id and entity_type = 'applicant' and entity_id = a.id;
  end if;

  update public.app_records set stage = 'hired', employee_id = eid where id = a.id;
  insert into public.app_record_events (tenant_id, record_id, kind, body, data)
  values (a.tenant_id, a.id, 'stage', 'Hired: employee record and onboarding checklist created', jsonb_build_object('from', a.stage, 'to', 'hired', 'employee_id', eid));
  if j.id is not null and coalesce(j.quantity, 0) > 0 then
    select count(*) into hired from public.app_records where tenant_id = a.tenant_id and app = 'recruitment' and kind = 'applicant' and parent_id = j.id and stage = 'hired';
    if hired >= j.quantity and j.stage <> 'filled' then
      update public.app_records set stage = 'filled' where id = j.id;
      insert into public.app_record_events (tenant_id, record_id, kind, body, data)
      values (a.tenant_id, j.id, 'stage', 'Filled: all openings hired', jsonb_build_object('from', j.stage, 'to', 'filled'));
    end if;
  end if;
  return eid;
end $$;
revoke all on function public.hr_hire_applicant(uuid) from public, anon;
grant execute on function public.hr_hire_applicant(uuid) to authenticated;
