GRANT SELECT (idle_timeout_minutes, daily_logout_time, session_warning_seconds) ON public.business_settings TO authenticated;
GRANT UPDATE (idle_timeout_minutes, daily_logout_time, session_warning_seconds) ON public.business_settings TO authenticated;
NOTIFY pgrst, 'reload schema';