-- Support pass: the platform owner, already through two-step sign-in on the admin address, opens a
-- company (Admin → Open company). That one new session is let past the company's two-step screen for
-- 12 hours. The pass is single-use (bound to the first session that claims it) and only for the owner.
create table if not exists public.support_passes (
  token_hash text primary key,
  user_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);
create index if not exists support_passes_user_idx on public.support_passes (user_id, session_id);
alter table public.support_passes enable row level security;
revoke all on public.support_passes from anon, authenticated;

create or replace function public.claim_support_pass(p_token text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare _sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid; _n int;
begin
  if auth.uid() is null or _sid is null or coalesce(p_token, '') = '' then return false; end if;
  update public.support_passes set session_id = _sid
   where token_hash = encode(digest(p_token, 'sha256'), 'hex') and user_id = auth.uid() and session_id is null and expires_at > now();
  get diagnostics _n = row_count;
  delete from public.support_passes where expires_at < now() - interval '1 day';
  return _n > 0;
end $$;
grant execute on function public.claim_support_pass(text) to authenticated;

create or replace function public.support_pass_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.support_passes
                  where user_id = auth.uid() and session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid and expires_at > now())
     and exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;
grant execute on function public.support_pass_ok() to authenticated;
