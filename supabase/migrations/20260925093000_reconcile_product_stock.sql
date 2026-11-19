-- Location stock drives the POS product list; align the older product mirror.
-- Only products with location-stock records are eligible.
WITH totals AS (
  SELECT product_id, SUM(stock) AS stock
  FROM public.product_stocks
  WHERE variant_id IS NULL
  GROUP BY product_id
)
UPDATE public.products AS p
SET stock = totals.stock
FROM totals
WHERE p.id = totals.product_id
  AND p.stock IS DISTINCT FROM totals.stock;
