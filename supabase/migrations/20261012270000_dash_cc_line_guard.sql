-- A company can only use a JMSURF pool number that JMSURF assigned to it.
-- (Companies may edit their own cc_settings row, so the number on it is checked here.)
create or replace function public.cc_settings_line_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare pool public.cc_numbers;
begin
  -- The servers (service role) and platform owners set lines freely.
  if auth.uid() is null or public.is_platform_admin() then return NEW; end if;
  if NEW.at_number is not distinct from (case when TG_OP = 'UPDATE' then OLD.at_number else null end)
     and NEW.line_mode is not distinct from (case when TG_OP = 'UPDATE' then OLD.line_mode else null end) then
    return NEW;
  end if;
  if NEW.at_number is not null then
    select * into pool from public.cc_numbers where number = NEW.at_number;
    if pool.id is not null and pool.tenant_id is distinct from NEW.tenant_id then
      raise exception 'That number belongs to JMSURF. Request a number in Settings → Phone line.';
    end if;
  end if;
  -- On a JMSURF line the number is whatever JMSURF assigned (or none yet).
  if NEW.line_mode = 'managed' then
    NEW.at_number := (select number from public.cc_numbers where tenant_id = NEW.tenant_id and status = 'assigned' limit 1);
  end if;
  return NEW;
end $$;
drop trigger if exists cc_settings_line_guard on public.cc_settings;
create trigger cc_settings_line_guard before insert or update of at_number, line_mode on public.cc_settings
  for each row execute function public.cc_settings_line_guard();
