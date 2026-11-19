
-- Fix FK constraints to allow deletions with SET NULL

-- transactions -> customers
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_customer_id_fkey;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;

-- invoices -> customers
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_customer_id_fkey;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;

-- quotes -> customers
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_customer_id_fkey;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;

-- product_stocks -> products
ALTER TABLE public.product_stocks DROP CONSTRAINT IF EXISTS product_stocks_product_id_fkey;
ALTER TABLE public.product_stocks ADD CONSTRAINT product_stocks_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

-- purchase_items -> products
ALTER TABLE public.purchase_items DROP CONSTRAINT IF EXISTS purchase_items_product_id_fkey;
ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

-- stock_adjustments -> products
ALTER TABLE public.stock_adjustments DROP CONSTRAINT IF EXISTS stock_adjustments_product_id_fkey;
ALTER TABLE public.stock_adjustments ADD CONSTRAINT stock_adjustments_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

-- purchase_items -> purchases
ALTER TABLE public.purchase_items DROP CONSTRAINT IF EXISTS purchase_items_purchase_id_fkey;
ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_purchase_id_fkey
  FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;

-- purchases -> suppliers
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_supplier_id_fkey;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- bills -> suppliers
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_supplier_id_fkey;
ALTER TABLE public.bills ADD CONSTRAINT bills_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
