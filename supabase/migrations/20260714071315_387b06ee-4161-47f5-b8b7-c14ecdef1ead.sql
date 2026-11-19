SET session_replication_role = replica;
DROP POLICY IF EXISTS agg_tx_public_insert ON public.aggregator_transactions;
DROP POLICY IF EXISTS delivery_conf_insert_public ON public.delivery_confirmations;
REVOKE INSERT ON public.aggregator_transactions FROM anon;
REVOKE INSERT ON public.delivery_confirmations FROM anon;
SET session_replication_role = origin;