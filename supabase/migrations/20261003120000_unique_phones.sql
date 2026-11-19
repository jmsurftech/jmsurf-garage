-- Every account has its own phone number: no two staff logins, no two
-- delivery-customer logins and no staff/customer pair may share one.
-- Numbers are compared on their last 9 digits (0712…, 254712…, +254 712…).

create or replace function public.norm_phone(p text)
returns text language sql immutable parallel safe as $$
  select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 9
              then right(regexp_replace(p, '\D', '', 'g'), 9) end
$$;

create unique index if not exists profiles_phone_unique
  on public.profiles (public.norm_phone(phone)) where public.norm_phone(phone) is not null;
create unique index if not exists customer_accounts_phone_unique
  on public.customer_accounts (public.norm_phone(phone));

-- Service-only lookup used by the app server before creating an account.
create or replace function public.phone_taken(p_phone text, p_user uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.norm_phone(p_phone) is not null and (
    exists (select 1 from profiles where norm_phone(phone) = norm_phone(p_phone) and user_id is distinct from p_user)
    or exists (select 1 from customer_accounts where norm_phone(phone) = norm_phone(p_phone))
  )
$$;
revoke all on function public.phone_taken(text, uuid) from public, anon, authenticated;
grant execute on function public.phone_taken(text, uuid) to service_role;

-- Friendly error for any clash (the unique indexes stay as the hard backstop).
create or replace function public.guard_unique_phone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.norm_phone(new.phone) is null then return new; end if;
  if tg_table_name = 'profiles' then
    if exists (select 1 from customer_accounts where norm_phone(phone) = norm_phone(new.phone))
       or exists (select 1 from profiles where norm_phone(phone) = norm_phone(new.phone) and id <> new.id) then
      raise exception 'This phone number already belongs to another account.' using errcode = '23505';
    end if;
  else
    if exists (select 1 from profiles where norm_phone(phone) = norm_phone(new.phone))
       or exists (select 1 from customer_accounts where norm_phone(phone) = norm_phone(new.phone) and id <> new.id) then
      raise exception 'This phone number already belongs to another account.' using errcode = '23505';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_unique_phone on public.profiles;
create trigger trg_unique_phone before insert or update of phone on public.profiles
  for each row execute function public.guard_unique_phone();
drop trigger if exists trg_unique_phone on public.customer_accounts;
create trigger trg_unique_phone before insert or update of phone on public.customer_accounts
  for each row execute function public.guard_unique_phone();

-- Shops may only request a domain; the server approves it once DNS proves
-- the shop controls it.
drop policy if exists td_insert on public.tenant_domains;
create policy td_insert on public.tenant_domains for insert to authenticated
  with check (tenant_id = current_user_tenant_id() and status = 'pending'
              and (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'manager'::app_role)));
