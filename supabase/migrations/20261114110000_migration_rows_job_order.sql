-- Move-in reads a job's staged rows in id order, 1,000 at a time. Without (job_id, id) every page
-- sorted the whole job (19k rows, on disk) and deep pages hit the 8s statement timeout.
create index concurrently if not exists migration_rows_job_order_idx on public.migration_rows (job_id, id);
