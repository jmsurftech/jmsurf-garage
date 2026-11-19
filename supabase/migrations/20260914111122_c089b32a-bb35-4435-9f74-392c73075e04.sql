ALTER TABLE public.products ALTER COLUMN stock TYPE numeric(14,3) USING stock::numeric;
ALTER TABLE public.product_stocks ALTER COLUMN stock TYPE numeric(14,3) USING stock::numeric;
ALTER TABLE public.stock_adjustments ALTER COLUMN quantity_change TYPE numeric(14,3) USING quantity_change::numeric;
ALTER TABLE public.stock_adjustments ALTER COLUMN stock_before TYPE numeric(14,3) USING stock_before::numeric;
ALTER TABLE public.stock_adjustments ALTER COLUMN stock_after TYPE numeric(14,3) USING stock_after::numeric;