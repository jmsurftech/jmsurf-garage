ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS stk_label_mode text NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS stk_label_override text;