ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_payment_method_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_payment_method_check
CHECK (payment_method IN ('cash','mpesa','card','credit','split','mobile_money','bank_transfer','other'));