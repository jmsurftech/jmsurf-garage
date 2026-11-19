-- Public demo company: same sample data as 20261012190000, with neutral names instead of
-- invented people and real company names, and no example.com addresses.
create or replace function public.demo_reset() returns text
language plpgsql security definer set search_path = public as $fn$
declare uid uuid; v_t uuid; tb text; pass int; left_ int; n int;
  keep text[] := array['tenants','business_settings','profiles','tenant_members','tenant_modules','subscriptions','subscription_payments','subscription_reminders',
    'chart_of_accounts','integration_secrets','tenant_domains','tenant_themes','tenant_feature_overrides','tenant_gateways','tenant_messaging','tenant_sms_settings',
    'tenant_sms_topups','tenant_payout_channels','tenant_bank_accounts','sendmoney_tenants','sendmoney_provisioning','document_templates','crm_stages','crm_tags',
    'crm_teams','crm_lost_reasons','crm_activity_types','hr_departments','hr_designations','hr_leave_types','hr_pay_items','hr_holidays','product_categories',
    'product_subcategories','product_units','expense_categories','bill_categories','app_definitions','inventory_settings','cc_settings','cc_queues','locations',
    'feature_audit_logs','user_activity_log','email_logs','tenant_backups','migration_jobs','migration_rows'];
begin
  select id into uid from auth.users where email = 'demo@jmsurfdash.co.ke';
  if uid is null then return 'no demo user'; end if;
  select tenant_id into v_t from public.profiles where user_id = uid;
  if v_t is null then return 'no demo company'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);

  -- Clear everything the visitors made, in passes (foreign keys decide the order).
  for pass in 1..6 loop
    left_ := 0;
    for tb in select c.table_name from information_schema.columns c join information_schema.tables x on x.table_name = c.table_name and x.table_schema = 'public' and x.table_type = 'BASE TABLE'
              where c.table_schema = 'public' and c.column_name = 'tenant_id' and not (c.table_name = any(keep)) loop
      begin
        execute format('delete from public.%I where tenant_id = $1', tb) using v_t;
      exception when others then left_ := left_ + 1;
      end;
    end loop;
    exit when left_ = 0;
  end loop;
  delete from public.locations where tenant_id = v_t and not coalesce(is_main, false);
  update public.product_stocks set stock = 0 where product_id not in (select id from public.products);

-- Locations
insert into locations(tenant_id,name,location_type,city,code) values (v_t,'Mombasa Road Warehouse','warehouse','Nairobi','WH-MSA'), (v_t,'Westlands Branch','branch','Nairobi','BR-WL');
insert into wh_bins(location_id,code,bin_type) select id, b, t from locations, (values ('A-01-01','storage'),('A-01-02','storage'),('RCV-01','receiving'),('QA-01','quarantine')) v(b,t) where name='Mombasa Road Warehouse' and tenant_id=v_t;

-- Customers and suppliers
insert into customers(tenant_id,name,phone,email,company_name,customer_type,credit_limit) values
 (v_t,'Construction Client Ltd','0712000101',null,'Construction Client','business',200000),
 (v_t,'Hotel Client','0712000102',null,'Hotel Client','business',500000),
 (v_t,'Walk-in Customer','0712000103',null,null,'individual',0),
 (v_t,'Wholesale Client','0712000104',null,'Wholesale Client','business',300000),
 (v_t,'Clinic Client','0712000105',null,'Clinic Client','business',100000);
insert into suppliers(tenant_id,name,phone,email,contact_person,is_active,payment_terms) values
 (v_t,'General Supplier','0722000201',null,'Sales desk',true,'Net 30'),
 (v_t,'Wholesale Supplier','0722000202',null,'Orders desk',true,'Net 14'),
 (v_t,'Freight Supplier','0722000203',null,'Operations desk',true,'Due on receipt');

-- Items
insert into products(tenant_id,name,sku,price,cost_price,category,unit,vat_rate,reorder_level,product_type) values
 (v_t,'Cooking Oil 5L','DM-OIL5',1450,1100,'General','piece',16,20,'product'),
 (v_t,'Maize Flour 2kg','DM-FLR2',210,165,'General','piece',0,50,'product'),
 (v_t,'Rice 5kg','DM-RCE5',980,760,'General','piece',0,15,'product'),
 (v_t,'Antibiotic 250mg','DM-AMX250',650,380,'General','box',0,10,'product'),
 (v_t,'Vaccine Pack','DM-VAX',2400,1500,'General','pack',0,5,'product'),
 (v_t,'Cement 50kg','DM-CEM50',780,690,'General','bag',16,40,'product'),
 (v_t,'Installation Service','DM-SVC-INST',5000,0,'General','job',16,0,'service'),
 (v_t,'Consulting (hour)','DM-SVC-HR',3500,0,'General','hour',16,0,'service');

-- Opening stock with batches at the head office and the warehouse
perform wh_receive((select id from locations where tenant_id=v_t and is_main limit 1), (select jsonb_agg(jsonb_build_object('product_id',id,'quantity',q,'batch_number',b,'expiry_date',e,'unit_cost',cost_price)) from (
  select p.id, p.cost_price, v.q, v.b, v.e from products p join (values ('DM-OIL5',60,'OIL-2601','2027-06-30'),('DM-FLR2',200,'FLR-2609','2027-01-31'),('DM-RCE5',40,'RCE-2608','2027-08-31'),
    ('DM-AMX250',25,'AMX-A1','2026-12-31'),('DM-AMX250',30,'AMX-B2','2027-09-30'),('DM-VAX',12,'VX-01','2026-11-30'),('DM-CEM50',120,null,null)) v(sku,q,b,e) on v.sku=p.sku where p.tenant_id=v_t) x), 'restock', 'opening', null, 'OPENING');
perform wh_receive((select id from locations where name='Mombasa Road Warehouse' and tenant_id=v_t), (select jsonb_agg(jsonb_build_object('product_id',id,'quantity',300,'batch_number','WH-'||sku,'expiry_date','2027-12-31','bin_id',(select id from wh_bins where code='A-01-01' and tenant_id=v_t))) from products where sku in ('DM-FLR2','DM-OIL5') and tenant_id=v_t), 'restock', 'opening', null, 'OPENING-WH');

-- Sales documents
insert into quotes(tenant_id,quote_number,customer_id,customer_name,items,subtotal,tax,total,status,issue_date,valid_until)
select v_t, next_doc_number('quote'), c.id, c.name, jsonb_build_array(jsonb_build_object('item_id',p.id,'name',p.name,'quantity',10,'rate',p.price,'tax_rate',16,'amount',10*p.price)), 10*p.price, 1.6*p.price, 11.6*p.price, 'sent', current_date, current_date+14
from customers c, products p where c.name='Hotel Client' and p.sku='DM-OIL5' and c.tenant_id=v_t and p.tenant_id=c.tenant_id;
insert into sales_orders(tenant_id,quote_number,customer_id,customer_name,items,subtotal,tax,total,status,issue_date)
select v_t, next_doc_number('sales_order'), c.id, c.name, jsonb_build_array(jsonb_build_object('item_id',p.id,'name',p.name,'quantity',20,'rate',p.price,'tax_rate',0,'amount',20*p.price),jsonb_build_object('item_id',q.id,'name',q.name,'quantity',5,'rate',q.price,'tax_rate',0,'amount',5*q.price)), 20*p.price+5*q.price, 0, 20*p.price+5*q.price, 'accepted', current_date
from customers c, products p, products q where c.name='Wholesale Client' and p.sku='DM-FLR2' and q.sku='DM-RCE5' and c.tenant_id=v_t and p.tenant_id=c.tenant_id and q.tenant_id=c.tenant_id;
insert into invoices(tenant_id,invoice_number,customer_id,customer_name,customer_phone,items,subtotal,tax,total,status,issue_date,due_date)
select v_t, next_doc_number('invoice'), c.id, c.name, c.phone, jsonb_build_array(jsonb_build_object('item_id',p.id,'name',p.name,'quantity',4,'rate',p.price,'tax_rate',0,'amount',4*p.price)), 4*p.price, 0, 4*p.price, 'sent', current_date-20, current_date-5
from customers c, products p where c.name='Clinic Client' and p.sku='DM-AMX250' and c.tenant_id=v_t and p.tenant_id=c.tenant_id;
insert into invoices(tenant_id,invoice_number,customer_id,customer_name,customer_phone,items,subtotal,tax,total,status,issue_date,due_date)
select v_t, next_doc_number('invoice'), c.id, c.name, c.phone, jsonb_build_array(jsonb_build_object('item_id',p.id,'name',p.name,'quantity',30,'rate',p.price,'tax_rate',16,'amount',30*p.price),jsonb_build_object('item_id',s.id,'name',s.name,'quantity',1,'rate',s.price,'tax_rate',16,'amount',s.price)), 30*p.price+s.price, round(0.16*(30*p.price+s.price),2), round(1.16*(30*p.price+s.price),2), 'sent', current_date-2, current_date+28
from customers c, products p, products s where c.name='Construction Client Ltd' and p.sku='DM-CEM50' and s.sku='DM-SVC-INST' and c.tenant_id=v_t and p.tenant_id=c.tenant_id and s.tenant_id=c.tenant_id;

-- Purchases
insert into purchases(po_number,supplier_id,supplier_name,location_id,order_date,expected_date,subtotal,tax,total,status)
select next_doc_number('po'), s.id, s.name, (select id from locations where tenant_id=v_t and is_main limit 1), current_date-3, current_date+4, 50*p.cost_price, 0, 50*p.cost_price, 'pending'
from suppliers s, products p where s.name='General Supplier' and p.sku='DM-OIL5' and s.tenant_id=v_t and p.tenant_id=s.tenant_id;
insert into purchase_items(purchase_id,product_id,quantity,unit_cost,total)
select (select id from purchases where supplier_name='General Supplier' and tenant_id=v_t order by created_at desc limit 1), id, 50, cost_price, 50*cost_price from products where sku='DM-OIL5' and tenant_id=v_t;
insert into bills(tenant_id,bill_number,name,supplier_id,category,bill_date,due_date,subtotal,tax,amount,amount_paid,status,is_recurring)
select v_t, next_doc_number('bill'), 'Wholesale Supplier', id, 'Purchases', current_date-10, current_date+4, 45000, 0, 45000, 0, 'pending', false from suppliers where name='Wholesale Supplier' and tenant_id=v_t;

-- Expenses
insert into expenses(tenant_id,expense_date,category_name,amount,description,payment_method,approval_status,location_id)
values (v_t,current_date-1,'Fuel',6500,'delivery van fuel','mpesa','approved',(select id from locations where tenant_id=v_t and is_main limit 1)),
       (v_t,current_date-4,'Office supplies',3200,'printer paper','cash','approved',(select id from locations where tenant_id=v_t and is_main limit 1)),
       (v_t,current_date-7,'Internet',5000,'monthly internet','bank','approved',(select id from locations where tenant_id=v_t and is_main limit 1));

-- CRM leads
insert into crm_leads(tenant_id,type,name,contact_name,email,phone,source,expected_revenue,active,probability)
values (v_t,'lead','Apartment block project','Facilities manager',null,'0733000301','Website',850000,true,20),
       (v_t,'opportunity','Hospital supply tender','Procurement officer',null,'0733000302','Referral',2400000,true,50),
       (v_t,'lead','School supply','School bursar',null,'0733000303','Walk-in',300000,true,10);

-- HR
insert into hr_employees(tenant_id,first_name,last_name,email,phone,hire_date,basic_salary,status,employee_no)
values (v_t,'Employee','001',null,'0744000401','2025-02-01',65000,'active','EMP-001'),
       (v_t,'Employee','002',null,'0744000402','2024-08-15',48000,'active','EMP-002'),
       (v_t,'Employee','003',null,'0744000403','2026-01-10',38000,'active','EMP-003');

-- Projects, helpdesk, appointments (record engine)
insert into app_records(app,kind,title,stage,data,customer_id,amount,due_date)
select 'projects','project','Site fit-out','in_progress',jsonb_build_object('_prefix','PRJ-','rate',2500),id,450000,current_date+30 from customers where name='Construction Client Ltd' and tenant_id=v_t;
insert into app_records(app,kind,title,stage,data,parent_id,due_date)
select 'projects','task',t,'open',jsonb_build_object('_prefix','TSK-'),(select id from app_records where title='Site fit-out' and tenant_id=v_t),current_date+d from (values ('site survey',3),('order materials',7),('install fittings',20)) v(t,d);
insert into app_records(app,kind,title,stage,priority,data,customer_id,due_date)
select 'helpdesk','ticket','delivery arrived damaged','new','High',jsonb_build_object('_prefix','TKT-','channel','Phone','description','Two bags of cement split.'),id,current_date+1 from customers where name='Construction Client Ltd' and tenant_id=v_t;
insert into app_records(app,kind,title,data) values ('appointments','appointment_type','Consultation',jsonb_build_object('minutes',30,'capacity',1,'online',true));


  select count(*) into n from public.invoices where tenant_id = v_t;
  return 'demo ready: ' || n || ' invoices';
end $fn$;
grant execute on function public.demo_reset() to service_role;
