alter table public.customers add column if not exists reminders_stopped boolean not null default false;
