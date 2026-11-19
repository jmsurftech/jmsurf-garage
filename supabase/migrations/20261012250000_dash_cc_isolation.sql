-- JMSURF CALL CENTRE isolation hardening.
-- 1) The line's callback key (the secret in the Africa's Talking callback URLs) is no longer
--    readable from the browser; managers get the URLs from the call centre server.
-- 2) Rows that point at other rows must point inside the same company: a call list item
--    at its list and customer, an agent at a member of that company.

do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cc_settings' and column_name <> 'callback_key';
  execute 'revoke select on public.cc_settings from anon, authenticated';
  execute format('grant select (%s) on public.cc_settings to authenticated', cols);
end $$;

create or replace function public.cc_same_company_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'cc_call_list_items' then
    if not exists (select 1 from public.cc_call_lists l where l.id = NEW.list_id and l.tenant_id = NEW.tenant_id) then
      raise exception 'That call list belongs to another company';
    end if;
    if NEW.customer_id is not null and not exists (select 1 from public.customers c where c.id = NEW.customer_id and c.tenant_id = NEW.tenant_id) then
      raise exception 'That customer belongs to another company';
    end if;
  elsif TG_TABLE_NAME = 'cc_agents' then
    if NEW.user_id is not null and not exists (
      select 1 from public.tenant_members m where m.user_id = NEW.user_id and m.tenant_id = NEW.tenant_id and m.status = 'active'
      union all
      select 1 from public.profiles p where p.user_id = NEW.user_id and p.tenant_id = NEW.tenant_id
    ) then
      raise exception 'Agents must be members of this company';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists cc_call_list_items_same_company on public.cc_call_list_items;
create trigger cc_call_list_items_same_company before insert or update of list_id, customer_id, tenant_id on public.cc_call_list_items
  for each row execute function public.cc_same_company_guard();
drop trigger if exists cc_agents_same_company on public.cc_agents;
create trigger cc_agents_same_company before insert or update of user_id, tenant_id on public.cc_agents
  for each row execute function public.cc_same_company_guard();

-- A company's own rows only: tenant_id can never be changed from the browser on these tables.
create or replace function public.cc_tenant_fixed() returns trigger
language plpgsql set search_path = public as $$
begin
  if NEW.tenant_id is distinct from OLD.tenant_id and auth.uid() is not null then
    raise exception 'Rows cannot be moved to another company';
  end if;
  return NEW;
end $$;
do $$ declare t text; begin
  foreach t in array array['cc_agents', 'cc_queues', 'cc_settings', 'cc_calls', 'cc_callbacks', 'cc_messages', 'cc_call_lists', 'cc_call_list_items', 'cc_blocked_numbers'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_tenant_fixed', t);
    execute format('create trigger %I before update of tenant_id on public.%I for each row execute function public.cc_tenant_fixed()', t || '_tenant_fixed', t);
  end loop;
end $$;
