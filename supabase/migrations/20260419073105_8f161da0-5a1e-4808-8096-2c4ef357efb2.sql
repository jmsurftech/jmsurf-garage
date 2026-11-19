-- Session timeout settings per tenant
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS idle_timeout_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS daily_logout_time text NOT NULL DEFAULT '04:00',
  ADD COLUMN IF NOT EXISTS session_warning_seconds integer NOT NULL DEFAULT 60;

COMMENT ON COLUMN public.business_settings.idle_timeout_minutes IS 'Minutes of inactivity before user is signed out';
COMMENT ON COLUMN public.business_settings.daily_logout_time IS 'Local time HH:MM at which all sessions are forced to end (e.g. 04:00 for 4am)';
COMMENT ON COLUMN public.business_settings.session_warning_seconds IS 'Seconds before idle timeout to show warning modal';