-- Test data for walking through the ERP. Every row is marked "Test data" (notes/description)
-- so it can be removed later with scripts/remove-test-data.sql.
\set t '''ec3d1fef-6e2b-4b60-b8f5-5275aaf2b8b7'''
begin;

-- Customers
insert into customers (tenant_id, name, phone, email, customer_type, company_name, credit_limit, credit_days, source, notes, approval_status, address, kra_pin)
values
 (:t, 'Jane Wanjiru', '0712345601', 'jane.wanjiru@example.com', 'individual', null, 20000, 30, 'pos', 'Test data', 'approved', 'Kilimani, Nairobi', null),
 (:t, 'Brian Otieno', '0712345602', 'brian.otieno@example.com', 'individual', null, 0, 0, 'pos', 'Test data', 'approved', 'Westlands, Nairobi', null),
 (:t, 'Happy Paws Vet Clinic', '0712345603', 'accounts@happypaws.example.com', 'business', 'Happy Paws Vet Clinic', 150000, 30, 'crm', 'Test data', 'approved', 'Ngong Road, Nairobi', 'P051234567Q'),
 (:t, 'Mary Akinyi', '0712345604', 'mary.akinyi@example.com', 'individual', null, 0, 0, 'shop', 'Test data', 'pending', 'Kileleshwa, Nairobi', null),
 (:t, 'Kevin Mwangi', '0712345605', null, 'individual', null, 5000, 14, 'shop', 'Test data', 'info_requested', null, null)
on conflict do nothing;
update customers set info_request = 'Please add your delivery address and email.' where tenant_id = :t and name = 'Kevin Mwangi';

-- Suppliers
insert into suppliers (tenant_id, name, contact_person, phone, email, kra_pin, payment_terms, category, onboarding_status, is_active, notes, address)
values
 (:t, 'Pet Nutrition Kenya Ltd', 'Samuel Kariuki', '0722000101', 'orders@petnutrition.example.com', 'P051111111A', 'Net 30', 'Pet food', 'active', true, 'Test data', 'Industrial Area, Nairobi'),
 (:t, 'VetMed Distributors', 'Grace Njeri', '0722000102', 'sales@vetmed.example.com', 'P052222222B', 'Net 15', 'Medicine', 'active', true, 'Test data', 'Mombasa Road, Nairobi'),
 (:t, 'Groom Pro Supplies', 'Ali Hassan', '0722000103', 'hello@groompro.example.com', null, 'Due on receipt', 'Grooming', 'pending', true, 'Test data', 'Eastleigh, Nairobi');

-- Quotes and invoices (Happy Paws and Jane)
with c as (select id, name, phone, email from customers where tenant_id = :t and notes = 'Test data'),
p as (select id, name, price from products where tenant_id = :t and image_url is not null order by name limit 6)
insert into quotes (tenant_id, quote_number, customer_id, customer_name, customer_phone, customer_email, items, subtotal, tax, discount, total, status, issue_date, valid_until, notes)
select :t, 'QT-T' || lpad(row_number() over ()::text, 3, '0'), c.id, c.name, c.phone, c.email,
  jsonb_build_array(jsonb_build_object('item_id', p.id, 'name', p.name, 'quantity', 3, 'rate', p.price, 'price', p.price, 'tax_rate', 0, 'discount', 0, 'amount', p.price * 3)),
  p.price * 3, 0, 0, p.price * 3, s.status, current_date - s.ago, current_date + 30 - s.ago, 'Test data'
from (values ('Happy Paws Vet Clinic', 'sent', 3, 0), ('Jane Wanjiru', 'accepted', 6, 1), ('Brian Otieno', 'draft', 1, 2)) as s(cust, status, ago, pi)
join c on c.name = s.cust join lateral (select * from p offset s.pi limit 1) p on true;

with c as (select id, name, phone, email from customers where tenant_id = :t and notes = 'Test data'),
p as (select id, name, price from products where tenant_id = :t and image_url is not null order by name)
insert into invoices (tenant_id, invoice_number, customer_id, customer_name, customer_phone, customer_email, items, subtotal, tax, discount, total, status, issue_date, due_date, payment_terms, notes, source)
select :t, 'INV-T' || lpad(row_number() over ()::text, 3, '0'), c.id, c.name, c.phone, c.email,
  jsonb_build_array(jsonb_build_object('item_id', p.id, 'name', p.name, 'quantity', s.qty, 'rate', p.price, 'price', p.price, 'tax_rate', 0, 'discount', 0, 'amount', p.price * s.qty)),
  p.price * s.qty, 0, 0, p.price * s.qty, 'sent', current_date - s.ago, current_date - s.ago + s.terms, 'Net ' || s.terms, 'Test data', 'manual'
from (values ('Happy Paws Vet Clinic', 10, 40, 30, 2), ('Happy Paws Vet Clinic', 4, 10, 30, 3), ('Jane Wanjiru', 2, 20, 14, 4), ('Jane Wanjiru', 5, 3, 14, 5)) as s(cust, qty, ago, terms, pi)
join c on c.name = s.cust join lateral (select * from p offset s.pi limit 1) p on true;

-- A payment applied to the oldest Happy Paws invoice, and one for Jane
with i as (select * from invoices where tenant_id = :t and notes = 'Test data' order by issue_date limit 1),
pr as (insert into payments_received (tenant_id, payment_number, customer_id, customer_name, payment_date, amount, method, reference, notes, received_by_name)
       select :t, 'PR-T001', i.customer_id, i.customer_name, current_date - 5, round(i.total / 2), 'mpesa', 'TST1A2B3C4', 'Test data', 'Test' from i returning *)
insert into payment_allocations (tenant_id, payment_id, invoice_id, amount) select :t, pr.id, i.id, pr.amount from pr, i;

with i as (select * from invoices where tenant_id = :t and notes = 'Test data' and customer_name = 'Jane Wanjiru' order by issue_date limit 1),
pr as (insert into payments_received (tenant_id, payment_number, customer_id, customer_name, payment_date, amount, method, reference, notes, received_by_name)
       select :t, 'PR-T002', i.customer_id, i.customer_name, current_date - 2, i.total, 'cash', null, 'Test data', 'Test' from i returning *)
insert into payment_allocations (tenant_id, payment_id, invoice_id, amount) select :t, pr.id, i.id, pr.amount from pr, i;

-- A credit note for Happy Paws (one damaged item), open
with c as (select id, name from customers where tenant_id = :t and name = 'Happy Paws Vet Clinic' and notes = 'Test data' limit 1),
p as (select id, name, price from products where tenant_id = :t and image_url is not null order by name offset 2 limit 1)
insert into credit_notes (tenant_id, credit_note_number, customer_id, customer_name, issue_date, reason, items, subtotal, total, status, notes)
select :t, 'CN-T001', c.id, c.name, current_date - 1, 'Damaged goods', jsonb_build_array(jsonb_build_object('item_id', p.id, 'name', p.name, 'quantity', 1, 'rate', p.price, 'amount', p.price)), p.price, p.price, 'open', 'Test data' from c, p;

-- Purchase orders: one issued (to receive), one draft
with s as (select id, name from suppliers where tenant_id = :t and name = 'Pet Nutrition Kenya Ltd' limit 1),
l as (select id from locations where tenant_id = :t order by is_main desc limit 1),
po as (insert into purchases (tenant_id, po_number, supplier_id, supplier_name, location_id, status, order_date, expected_date, subtotal, total, notes)
       select :t, 'PO-T001', s.id, s.name, l.id, 'pending', current_date - 3, current_date + 4, 0, 0, 'Test data' from s, l returning id)
insert into purchase_items (purchase_id, product_id, quantity, unit_cost, total)
select po.id, p.id, 10, round(p.price * 0.7), round(p.price * 0.7) * 10 from po, (select id, price from products where tenant_id = :t and category = 'Pet Food' order by name limit 3) p;
update purchases set subtotal = x.t, total = x.t from (select purchase_id, sum(total) t from purchase_items group by 1) x where x.purchase_id = purchases.id and purchases.po_number = 'PO-T001';

with s as (select id, name from suppliers where tenant_id = :t and name = 'VetMed Distributors' limit 1),
l as (select id from locations where tenant_id = :t order by is_main desc limit 1),
po as (insert into purchases (tenant_id, po_number, supplier_id, supplier_name, location_id, status, order_date, expected_date, subtotal, total, notes)
       select :t, 'PO-T002', s.id, s.name, l.id, 'draft', current_date, current_date + 7, 0, 0, 'Test data' from s, l returning id)
insert into purchase_items (purchase_id, product_id, quantity, unit_cost, total)
select po.id, p.id, 6, round(p.price * 0.65), round(p.price * 0.65) * 6 from po, (select id, price from products where tenant_id = :t and category = 'Medication' order by name limit 2) p;
update purchases set subtotal = x.t, total = x.t from (select purchase_id, sum(total) t from purchase_items group by 1) x where x.purchase_id = purchases.id and purchases.po_number = 'PO-T002';

-- A supplier bill (open, part paid)
with s as (select id, name from suppliers where tenant_id = :t and name = 'Groom Pro Supplies' limit 1)
insert into bills (tenant_id, name, bill_number, category, amount, subtotal, amount_paid, status, supplier_id, bill_date, due_date, reference, items, notes)
select :t, s.name || ' · BILL-T001', 'BILL-T001', 'Supplies', 18500, 18500, 5000, 'partial', s.id, current_date - 12, current_date + 3, 'GP-INV-7781',
  '[{"name":"Grooming scissors (set)","quantity":5,"rate":2500,"amount":12500},{"name":"Pet shampoo 5L","quantity":2,"rate":3000,"amount":6000}]'::jsonb, 'Test data' from s;
insert into supplier_payments (tenant_id, bill_id, supplier_id, amount, method, reference, paid_on, notes, recorded_by_name)
select :t, b.id, b.supplier_id, 5000, 'mpesa', 'TST9X8Y7Z', current_date - 6, 'Test data', 'Test' from bills b where b.bill_number = 'BILL-T001';

-- Expenses
insert into expenses (tenant_id, category_name, description, amount, expense_date)
values (:t, 'Rent', 'Shop rent (Test data)', 45000, date_trunc('month', current_date)::date),
       (:t, 'Utilities', 'Electricity tokens (Test data)', 3500, current_date - 4),
       (:t, 'Transport', 'Delivery fuel (Test data)', 2200, current_date - 2),
       (:t, 'Marketing', 'Flyers printing (Test data)', 4800, current_date - 9);

-- Employees
insert into hr_employees (tenant_id, employee_no, first_name, last_name, gender, date_of_birth, national_id, kra_pin, nssf_no, shif_no, phone, email,
  department_id, employment_type, hire_date, status, basic_salary, house_allowance, payment_method, bank_name, bank_account, mpesa_phone, notes)
select :t, v.no, v.fn, v.ln, v.g, v.dob::date, v.nid, v.pin, v.nssf, v.shif, v.ph, v.em, d.id, v.typ, v.hired::date, 'active', v.basic, v.house, v.pay, v.bank, v.acc, v.mp, 'Test data'
from (values
  ('EMP-T001', 'Faith', 'Muthoni', 'female', '1994-03-12', '30123456', 'A001234567B', 'NSSF001', 'SHA001', '0733000001', 'faith@example.com', 'Shop floor', 'permanent', '2024-02-01', 38000, 6000, 'bank', 'Equity Bank', '0123456789012', null),
  ('EMP-T002', 'Peter', 'Kamau', 'male', '1990-07-22', '28123456', 'A002345678C', 'NSSF002', 'SHA002', '0733000002', 'peter@example.com', 'Stores & logistics', 'permanent', '2023-06-15', 45000, 8000, 'mpesa', null, null, '0733000002'),
  ('EMP-T003', 'Lucy', 'Achieng', 'female', '1998-11-02', '35123456', 'A003456789D', 'NSSF003', 'SHA003', '0733000003', 'lucy@example.com', 'Grooming & care', 'contract', '2025-09-01', 32000, 0, 'mpesa', null, null, '0733000003'),
  ('EMP-T004', 'David', 'Ochieng', 'male', '1987-01-30', '25123456', 'A004567890E', 'NSSF004', 'SHA004', '0733000004', 'david@example.com', 'Sales', 'permanent', '2022-01-10', 60000, 10000, 'bank', 'KCB', '1100223344', null)
) as v(no, fn, ln, g, dob, nid, pin, nssf, shif, ph, em, dept, typ, hired, basic, house, pay, bank, acc, mp)
left join hr_departments d on d.tenant_id = :t and d.name = v.dept
on conflict do nothing;
insert into hr_pay_items (tenant_id, employee_id, kind, name, amount, taxable)
select :t, e.id, 'allowance', 'Transport', 3000, true from hr_employees e where e.tenant_id = :t and e.employee_no in ('EMP-T001', 'EMP-T004');
insert into hr_pay_items (tenant_id, employee_id, kind, name, amount, taxable)
select :t, e.id, 'deduction', 'SACCO', 2000, false from hr_employees e where e.tenant_id = :t and e.employee_no = 'EMP-T002';
insert into hr_loans (tenant_id, employee_id, kind, principal, monthly_installment, balance, issued_on, note)
select :t, e.id, 'advance', 6000, 3000, 6000, current_date - 10, 'Test data' from hr_employees e where e.tenant_id = :t and e.employee_no = 'EMP-T003';

-- Leave: one approved, one pending, one rejected
insert into hr_leave_requests (tenant_id, employee_id, leave_type_id, start_date, end_date, days, reason, status, decision_note)
select :t, e.id, lt.id, v.s::date, v.e::date, v.d, v.r, v.st, v.n
from (values ('EMP-T001', 'Annual leave', current_date + 7, current_date + 9, 3, 'Family visit (Test data)', 'pending', null),
             ('EMP-T002', 'Sick leave', current_date - 8, current_date - 7, 2, 'Flu (Test data)', 'approved', null),
             ('EMP-T003', 'Annual leave', current_date + 2, current_date + 6, 4, 'Travel (Test data)', 'rejected', 'Busy week, please pick other dates')) as v(no, typ, s, e, d, r, st, n)
join hr_employees e on e.tenant_id = :t and e.employee_no = v.no
join hr_leave_types lt on lt.tenant_id = :t and lt.name = v.typ;

-- Attendance for the last 5 working days
insert into hr_attendance (tenant_id, employee_id, date, status, clock_in, clock_out, hours, overtime_hours, note)
select :t, e.id, d::date,
  case when e.employee_no = 'EMP-T003' and extract(dow from d) = 3 then 'absent' when e.employee_no = 'EMP-T001' and extract(dow from d) = 1 then 'late' else 'present' end,
  case when e.employee_no = 'EMP-T003' and extract(dow from d) = 3 then null when e.employee_no = 'EMP-T001' and extract(dow from d) = 1 then time '08:52' else time '08:05' end,
  case when e.employee_no = 'EMP-T003' and extract(dow from d) = 3 then null else time '17:30' end,
  case when e.employee_no = 'EMP-T003' and extract(dow from d) = 3 then 0 else 9.4 end,
  case when e.employee_no = 'EMP-T004' then 1.5 else 0 end, 'Test data'
from hr_employees e, generate_series(current_date - 7, current_date - 1, interval '1 day') d
where e.tenant_id = :t and e.notes = 'Test data' and extract(dow from d) between 1 and 6
on conflict (employee_id, date) do nothing;

-- CRM
insert into crm_campaigns (tenant_id, name, channel, status, start_date, end_date, budget, actual_cost, expected_revenue, target_audience, description)
values (:t, 'October dog food promo', 'sms', 'active', current_date - 5, current_date + 20, 15000, 6000, 120000, 'Dog owners in Nairobi', 'Test data'),
       (:t, 'Vet clinic partnerships', 'event', 'planned', current_date + 10, current_date + 40, 30000, 0, 400000, 'Vet clinics', 'Test data');
insert into crm_leads (tenant_id, type, name, contact_name, partner_name, phone, mobile, email, expected_revenue, probability, source, campaign, description, stage_id)
select :t, v.typ, v.n, v.cn, v.pn, v.ph, v.ph, v.em, v.rev, v.pr, v.src, v.camp, 'Test data', (select id from crm_stages where tenant_id = :t order by sequence offset v.stg limit 1)
from (values ('lead', 'Bulk cat litter for shelter', 'Esther Wambui', 'Paws Rescue Shelter', '0745000001', 'esther@pawsrescue.example.com', 85000, 20, 'Website', 'October dog food promo', 0),
             ('opportunity', 'Monthly vet supplies', 'Dr. Ken Mutua', 'Mutua Vet Services', '0745000002', 'ken@mutuavet.example.com', 240000, 50, 'Referral', 'Vet clinic partnerships', 1),
             ('opportunity', 'Kennel club grooming contract', 'Ann Chebet', 'Nairobi Kennel Club', '0745000003', 'ann@kennelclub.example.com', 180000, 70, 'Event', null, 2),
             ('lead', 'Aquarium starter kits', 'Tom Njoroge', null, '0745000004', 'tom.n@example.com', 25000, 10, 'Walk-in', null, 0)) as v(typ, n, cn, pn, ph, em, rev, pr, src, camp, stg);

commit;
