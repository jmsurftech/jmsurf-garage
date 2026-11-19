ALTER TABLE public.business_settings
ADD COLUMN IF NOT EXISTS use_platform_smtp boolean NOT NULL DEFAULT false;