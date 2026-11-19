-- Platform owner access without switching roles in the database.
-- Before: opening the super admin made the owner super_admin in user_roles and
-- opening a company switched it back, so a company tab and the admin tab undid
-- each other (pages reloading, admin not opening). Now: super_admin powers come
-- from platform_admins, and only for requests that the super admin address
-- marks with the x-dash-context: platform header. user_roles keeps the
-- person's company role at all times.
create or replace function public.platform_context()
returns boolean language sql stable set search_path = public as $$
  select coalesce((nullif(current_setting('request.headers', true), '')::json ->> 'x-dash-context'), '') = 'platform'
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select case when _role = 'super_admin'
    then public.platform_context() and exists (select 1 from public.platform_admins where user_id = _user_id)
    else exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
  end
$$;

/** Kept for the app: true when the caller is a platform owner (nothing is changed). */
create or replace function public.enter_platform()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
$$;

-- Nobody keeps a stored super_admin role any more.
delete from public.user_roles where role = 'super_admin';
