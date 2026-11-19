ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS last_expiry_reminder_at timestamptz;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS last_expired_reminder_at timestamptz;