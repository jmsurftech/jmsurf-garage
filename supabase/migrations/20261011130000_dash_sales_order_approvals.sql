-- Sales orders can need approval too (System → Approvals → Sales orders).
create or replace function public._approval_table(p_type text)
returns text language sql immutable as $$
  select case p_type when 'quote' then 'quotes' when 'invoice' then 'invoices' when 'purchase_order' then 'purchases' when 'bill' then 'bills'
    when 'expense' then 'expenses' when 'credit_note' then 'credit_notes' when 'payroll' then 'hr_payroll_runs' when 'requisition' then 'requisitions'
    when 'sales_order' then 'sales_orders' end
$$;
