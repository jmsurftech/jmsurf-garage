-- New shops start on the JMSURF gateway (SendMoney). Owners only enter their
-- Till, Paybill or bank account in Settings and payments settle there.
-- Existing shops keep whatever gateway they chose.
ALTER TABLE public.business_settings ALTER COLUMN payment_provider SET DEFAULT 'jmsurf';
