-- Removes the walkthrough data added by seed-test-data.sql (rows marked "Test data").
-- Documents created while testing (GRN-000001, BILL-000001 from PO-T001) go with their purchase order.
\set t '''ec3d1fef-6e2b-4b60-b8f5-5275aaf2b8b7'''
begin;
delete from payment_allocations where payment_id in (select id from payments_received where tenant_id = :t and notes = 'Test data');
delete from payments_received where tenant_id = :t and notes = 'Test data';
delete from credit_notes where tenant_id = :t and notes = 'Test data';
delete from invoices where tenant_id = :t and notes = 'Test data';
delete from quotes where tenant_id = :t and notes = 'Test data';
delete from supplier_payments where tenant_id = :t and notes = 'Test data';
delete from bills where tenant_id = :t and (notes = 'Test data' or purchase_id in (select id from purchases where tenant_id = :t and notes = 'Test data'));
delete from purchase_receives where purchase_id in (select id from purchases where tenant_id = :t and notes = 'Test data');
delete from purchase_items where purchase_id in (select id from purchases where tenant_id = :t and notes = 'Test data');
delete from purchases where tenant_id = :t and notes = 'Test data';
delete from expenses where tenant_id = :t and description like '%(Test data)';
delete from hr_attendance where tenant_id = :t and note = 'Test data';
delete from hr_leave_requests where tenant_id = :t and reason like '%(Test data)';
delete from hr_loans where tenant_id = :t and note = 'Test data';
delete from hr_pay_items where employee_id in (select id from hr_employees where tenant_id = :t and notes = 'Test data');
delete from hr_employees where tenant_id = :t and notes = 'Test data';
delete from crm_leads where tenant_id = :t and description = 'Test data';
delete from crm_campaigns where tenant_id = :t and description = 'Test data';
delete from suppliers where tenant_id = :t and notes = 'Test data';
delete from customers where tenant_id = :t and notes = 'Test data';
commit;
