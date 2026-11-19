-- JMSURF Garage demo company (slug demo, login demo@jmsurf.co.ke).
-- The DASH demo functions looked for the DASH demo login and filled a retail shop; these
-- versions use the Garage demo login and fill a working garage: customers, vehicles, parts
-- in stock, bays, job cards in every stage, invoices, bookings and the specialist modules.
-- Nothing leaves the demo (messages are off for slug demo in the server). The demo login
-- cannot change its password or email. Safe to run more than once.

create or replace function public.demo_login_locked() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if OLD.email in ('demo@jmsurf.co.ke', 'demo@jmsurfdash.co.ke') then
    NEW.encrypted_password := OLD.encrypted_password;
    NEW.email := OLD.email;
  end if;
  return NEW;
end $$;

create or replace function public.demo_prepare() returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid; t uuid; plan record;
begin
  select id into uid from auth.users where email = 'demo@jmsurf.co.ke';
  select tenant_id into t from public.profiles where user_id = uid;
  if t is null then return null; end if;
  insert into public.tenant_modules (tenant_id, module_key, status, price_monthly, activated_by)
  select t, m.key, 'comped', 0, uid from public.platform_modules m where m.is_active and not m.included
  on conflict do nothing;
  update public.tenant_modules set status = 'comped', price_monthly = 0, trial_ends_at = null where tenant_id = t;
  select * into plan from public.plans where is_active order by all_modules desc nulls last, price_monthly desc limit 1;
  update public.subscriptions set status = 'active', plan_id = coalesce(plan.id, plan_id), plan_name = coalesce(plan.name, plan_name),
    trial_ends_at = null, current_period_end = now() + interval '10 years' where tenant_id = t;
  update public.business_settings set erp_settings = coalesce(erp_settings, '{}'::jsonb)
    || jsonb_build_object('garage_business_kinds', jsonb_build_array('mechanical', 'spares', 'body_paint', 'car_wash', 'tyres', 'imports', 'vehicle_yard', 'towing', 'car_hire', 'fleet'))
   where tenant_id = t;
  return t;
end $$;
revoke all on function public.demo_prepare() from public, anon, authenticated;
grant execute on function public.demo_prepare() to service_role;

/** Fills the demo garage. Runs as the demo login (column defaults pick its company). */
create or replace function public.garage_demo_seed(v_t uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare main_loc uuid; j uuid; inv uuid; c record; n int;
begin
  select id into main_loc from locations where tenant_id = v_t and is_main limit 1;

  insert into garage_settings (tenant_id, booking_enabled, booking_services, labour_rate, default_location_id, qc_checklist)
  values (v_t, true, array['Full service', 'Brake service', 'Diagnosis', 'Wheel alignment', 'Car wash'], 1500, main_loc,
          '["Road test done", "No warning lights", "Fluids topped up", "Wheel nuts torqued", "Car cleaned inside"]'::jsonb)
  on conflict (tenant_id) do update set booking_enabled = true, labour_rate = 1500, default_location_id = main_loc;

  insert into garage_bays (tenant_id, name, kind, sort) values
    (v_t, 'Bay 1', 'lift', 1), (v_t, 'Bay 2', 'lift', 2), (v_t, 'Bay 3', 'pit', 3), (v_t, 'Wash bay', 'wash', 4), (v_t, 'Paint booth', 'paint_booth', 5);

  insert into customers (tenant_id, name, phone, company_name, customer_type, credit_limit) values
    (v_t, 'Fleet Client Ltd', '0712000101', 'Fleet Client', 'business', 300000),
    (v_t, 'Taxi Operator', '0712000102', null, 'individual', 0),
    (v_t, 'School Transport', '0712000103', 'School Transport', 'business', 150000),
    (v_t, 'Delivery Company', '0712000104', 'Delivery Company', 'business', 200000),
    (v_t, 'Private Owner A', '0712000105', null, 'individual', 0),
    (v_t, 'Private Owner B', '0712000106', null, 'individual', 0),
    (v_t, 'Matatu Sacco', '0712000107', 'Matatu Sacco', 'business', 250000),
    (v_t, 'Walk-in Customer', '0712000108', null, 'individual', 0);
  insert into suppliers (tenant_id, name, phone, contact_person, is_active, payment_terms) values
    (v_t, 'Parts Wholesaler', '0722000201', 'Sales desk', true, 'Net 30'),
    (v_t, 'Tyre Distributor', '0722000202', 'Orders desk', true, 'Net 14'),
    (v_t, 'Lubricants Supplier', '0722000203', 'Orders desk', true, 'Due on receipt');

  insert into garage_vehicles (tenant_id, customer_id, plate, make, model, year, vehicle_type, fuel, transmission, colour, mileage, insurance_expiry, inspection_expiry, next_service_date)
  select v_t, (select id from customers where tenant_id = v_t and name = v.owner), v.plate, v.make, v.model, v.yr, v.vt, v.fuel, v.tr, v.col, v.km,
         current_date + v.ins, current_date + v.insp, current_date + v.svc
  from (values
    ('Fleet Client Ltd', 'KDM 101A', 'Toyota', 'Probox', 2016, 'van', 'Petrol', 'Automatic', 'White', 214500, 120, 60, 5),
    ('Fleet Client Ltd', 'KDM 102A', 'Toyota', 'Probox', 2017, 'van', 'Petrol', 'Automatic', 'Silver', 188200, 140, 90, 30),
    ('Taxi Operator', 'KDK 203B', 'Toyota', 'Fielder', 2015, 'car', 'Petrol', 'Automatic', 'Grey', 241000, 20, 45, -3),
    ('School Transport', 'KCZ 304C', 'Toyota', 'Hiace', 2014, 'bus', 'Diesel', 'Manual', 'White', 312400, 75, 12, 14),
    ('Delivery Company', 'KDJ 405D', 'Isuzu', 'NQR', 2018, 'truck', 'Diesel', 'Manual', 'White', 276800, 200, 100, 21),
    ('Private Owner A', 'KDN 506E', 'Mazda', 'Demio', 2017, 'car', 'Petrol', 'Automatic', 'Red', 96300, 180, 300, 60),
    ('Private Owner B', 'KDL 607F', 'Subaru', 'Forester', 2016, 'SUV', 'Petrol', 'Automatic', 'Blue', 132700, 33, 210, 45),
    ('Matatu Sacco', 'KCY 708G', 'Nissan', 'Caravan', 2013, 'matatu', 'Diesel', 'Manual', 'White', 401200, 10, 8, 2),
    ('Walk-in Customer', 'KDP 809H', 'Toyota', 'Hilux', 2019, 'pickup', 'Diesel', 'Manual', 'Silver', 154900, 250, 150, 90),
    ('Private Owner A', 'KDQ 910J', 'Toyota', 'Land Cruiser Prado', 2018, 'SUV', 'Diesel', 'Automatic', 'Black', 118400, 300, 260, 75)
  ) v(owner, plate, make, model, yr, vt, fuel, tr, col, km, ins, insp, svc);

  insert into products (tenant_id, name, sku, price, cost_price, category, unit, vat_rate, reorder_level, product_type) values
    (v_t, 'Engine oil 5W-30 4L', 'GD-OIL4', 4200, 3100, 'Lubricants', 'piece', 16, 10, 'product'),
    (v_t, 'Oil filter (Toyota)', 'GD-OF-TY', 650, 380, 'Filters', 'piece', 16, 15, 'product'),
    (v_t, 'Air filter (Toyota)', 'GD-AF-TY', 1100, 650, 'Filters', 'piece', 16, 10, 'product'),
    (v_t, 'Brake pads front (Probox / Fielder)', 'GD-BPF', 3200, 2100, 'Brakes', 'set', 16, 6, 'product'),
    (v_t, 'Brake disc front', 'GD-BDF', 4800, 3300, 'Brakes', 'piece', 16, 4, 'product'),
    (v_t, 'Spark plugs (set of 4)', 'GD-SPK4', 2400, 1500, 'Ignition', 'set', 16, 6, 'product'),
    (v_t, 'Battery N70 12V', 'GD-BAT70', 14500, 11200, 'Electrical', 'piece', 16, 3, 'product'),
    (v_t, 'Tyre 195/65 R15', 'GD-TY19565', 8900, 6800, 'Tyres', 'piece', 16, 8, 'product'),
    (v_t, 'Shock absorber front', 'GD-SHKF', 6500, 4400, 'Suspension', 'piece', 16, 4, 'product'),
    (v_t, 'Timing belt kit', 'GD-TBK', 9800, 6900, 'Engine', 'kit', 16, 2, 'product'),
    (v_t, 'Coolant 4L', 'GD-CLT4', 1800, 1150, 'Lubricants', 'piece', 16, 8, 'product'),
    (v_t, 'Wiper blades (pair)', 'GD-WPR', 1500, 850, 'Accessories', 'pair', 16, 10, 'product'),
    (v_t, 'Full service labour', 'GD-L-SVC', 3500, 0, 'Labour', 'job', 16, 0, 'service'),
    (v_t, 'Brake service labour', 'GD-L-BRK', 2500, 0, 'Labour', 'job', 16, 0, 'service'),
    (v_t, 'Computer diagnosis', 'GD-L-DIAG', 2000, 0, 'Labour', 'job', 16, 0, 'service'),
    (v_t, 'Wheel alignment', 'GD-L-ALN', 2500, 0, 'Labour', 'job', 16, 0, 'service');

  if main_loc is not null then
    perform wh_receive(main_loc, (select jsonb_agg(jsonb_build_object('product_id', p.id, 'quantity', v.q, 'unit_cost', p.cost_price))
      from products p join (values ('GD-OIL4', 40), ('GD-OF-TY', 60), ('GD-AF-TY', 30), ('GD-BPF', 18), ('GD-BDF', 8), ('GD-SPK4', 20),
        ('GD-BAT70', 6), ('GD-TY19565', 24), ('GD-SHKF', 4), ('GD-TBK', 3), ('GD-CLT4', 25), ('GD-WPR', 30)) v(sku, q) on v.sku = p.sku
      where p.tenant_id = v_t), 'restock', 'opening', null, 'OPENING');
  end if;

  insert into hr_employees (tenant_id, first_name, last_name, phone, hire_date, basic_salary, status, employee_no) values
    (v_t, 'Mechanic', '001', '0744000401', '2024-03-01', 45000, 'active', 'EMP-001'),
    (v_t, 'Mechanic', '002', '0744000402', '2025-01-15', 38000, 'active', 'EMP-002'),
    (v_t, 'Service advisor', '003', '0744000403', '2023-09-01', 52000, 'active', 'EMP-003'),
    (v_t, 'Washer', '004', '0744000404', '2026-02-01', 22000, 'active', 'EMP-004');

  -- Job cards in every stage of the workshop flow.
  for c in select * from (values
    (1, 'KDM 101A', 'collected', 'mechanical', 'Full service due, squeal when braking', 'Front pads worn to 2 mm', 214500, -9, 'Bay 1'),
    (2, 'KDK 203B', 'collected', 'mechanical', 'Engine light on', 'Misfire cylinder 3, plugs worn', 241000, -6, 'Bay 2'),
    (3, 'KDN 506E', 'ready', 'mechanical', 'Service and check AC', 'Service done, AC gas fine', 96300, -1, 'Bay 1'),
    (4, 'KDL 607F', 'quality_check', 'mechanical', 'Knocking sound front left', 'Front left shock absorber leaking', 132700, -1, 'Bay 2'),
    (5, 'KCZ 304C', 'in_progress', 'mechanical', 'Full service before school term', null, 312400, 0, 'Bay 3'),
    (6, 'KDJ 405D', 'in_progress', 'tyres', 'Two front tyres and alignment', 'Front tyres below limit', 276800, 0, 'Bay 1'),
    (7, 'KCY 708G', 'waiting_parts', 'mechanical', 'Timing belt due', 'Timing belt kit ordered', 401200, 0, null),
    (8, 'KDM 102A', 'waiting_approval', 'mechanical', 'Brakes feel soft', 'Front discs scored, pads worn', 188200, 0, 'Bay 2'),
    (9, 'KDP 809H', 'diagnosing', 'mechanical', 'Battery keeps going flat', null, 154900, 0, null),
    (10, 'KDQ 910J', 'checked_in', 'mechanical', 'Routine service', null, 118400, 0, null)
  ) x(i, plate, st, jt, complaint, findings, km, days, bay) loop
    insert into garage_jobs (tenant_id, vehicle_id, customer_id, status, job_type, complaint, findings, mileage_in, bay, bay_id,
                             promised_at, fuel_level, checked_in_at, gate_released_at, mileage_out)
    select v_t, v.id, v.customer_id, c.st, c.jt, c.complaint, c.findings, c.km, c.bay,
           (select id from garage_bays where tenant_id = v_t and name = c.bay),
           now() + make_interval(days => greatest(c.days, 0) + 1), 'Half', now() + make_interval(days => c.days),
           case when c.st = 'collected' then now() + make_interval(days => c.days + 1) end,
           case when c.st = 'collected' then c.km + 12 end
      from garage_vehicles v where v.tenant_id = v_t and v.plate = public.garage_plate(c.plate)
    returning id into j;

    -- Lines: labour and parts; approved once the customer said yes (from in progress on).
    insert into garage_job_lines (tenant_id, job_id, kind, item_id, description, qty, rate, tax_rate, priority, approved, approved_via, status, sort)
    select v_t, j, case when p.product_type = 'service' then 'labour' else 'part' end, p.id, p.name, l.q, p.price, 16, l.pr,
           case when c.st in ('checked_in', 'diagnosing', 'waiting_approval') then null else true end,
           case when c.st in ('checked_in', 'diagnosing', 'waiting_approval') then null else 'link' end,
           case when c.st in ('collected', 'ready', 'quality_check') then 'done' when c.st = 'in_progress' then 'in_progress' else 'pending' end,
           l.s
      from (values
        (1, 'GD-L-SVC', 1, 'must', 1), (1, 'GD-OIL4', 1, 'must', 2), (1, 'GD-OF-TY', 1, 'must', 3), (1, 'GD-BPF', 1, 'must', 4), (1, 'GD-L-BRK', 1, 'must', 5),
        (2, 'GD-L-DIAG', 1, 'must', 1), (2, 'GD-SPK4', 1, 'must', 2),
        (3, 'GD-L-SVC', 1, 'must', 1), (3, 'GD-OIL4', 1, 'must', 2), (3, 'GD-OF-TY', 1, 'must', 3), (3, 'GD-AF-TY', 1, 'advised', 4),
        (4, 'GD-SHKF', 2, 'must', 1), (4, 'GD-L-BRK', 1, 'must', 2),
        (5, 'GD-L-SVC', 1, 'must', 1), (5, 'GD-OIL4', 2, 'must', 2), (5, 'GD-OF-TY', 1, 'must', 3), (5, 'GD-CLT4', 1, 'advised', 4),
        (6, 'GD-TY19565', 2, 'must', 1), (6, 'GD-L-ALN', 1, 'must', 2),
        (7, 'GD-TBK', 1, 'must', 1), (7, 'GD-L-SVC', 1, 'must', 2),
        (8, 'GD-BDF', 2, 'must', 1), (8, 'GD-BPF', 1, 'must', 2), (8, 'GD-L-BRK', 1, 'must', 3), (8, 'GD-WPR', 1, 'optional', 4),
        (9, 'GD-L-DIAG', 1, 'must', 1), (9, 'GD-BAT70', 1, 'advised', 2)
      ) l(i, sku, q, pr, s)
      join products p on p.sku = l.sku and p.tenant_id = v_t
     where l.i = c.i;

    -- Invoices for cars that are ready or gone home (paid when collected).
    if c.st in ('collected', 'ready') then
      insert into invoices (tenant_id, invoice_number, customer_id, customer_name, customer_phone, items, subtotal, tax, total, status, issue_date, due_date)
      select v_t, next_doc_number('invoice'), cu.id, cu.name, cu.phone,
             (select jsonb_agg(jsonb_build_object('item_id', gl.item_id, 'name', gl.description, 'quantity', gl.qty, 'rate', gl.rate, 'tax_rate', 16, 'amount', gl.qty * gl.rate) order by gl.sort)
                from garage_job_lines gl where gl.job_id = j),
             g.estimate_subtotal, g.estimate_tax, g.estimate_total,
             case when c.st = 'collected' then 'paid' else 'sent' end, (current_date + c.days), (current_date + c.days + 7)
        from garage_jobs g join customers cu on cu.id = g.customer_id where g.id = j
      returning id into inv;
      update garage_jobs set invoice_id = inv where id = j;
      update garage_job_lines set invoice_id = inv where job_id = j;
      insert into garage_job_invoices (tenant_id, job_id, invoice_id) values (v_t, j, inv);
    end if;
  end loop;

  -- Bookings for the next two days.
  insert into garage_bookings (tenant_id, customer_id, vehicle_id, name, phone, plate, service, starts_at, source, status)
  select v_t, v.customer_id, v.id, cu.name, cu.phone, v.plate, b.svc, date_trunc('day', now()) + make_interval(days => b.d, hours => b.h), b.src, 'confirmed'
    from (values ('KDM 102A', 'Brake service', 1, 9, 'online'), ('KCZ 304C', 'Wheel alignment', 1, 11, 'phone'), ('KDL 607F', 'Full service', 2, 10, 'whatsapp')) b(plate, svc, d, h, src)
    join garage_vehicles v on v.plate = public.garage_plate(b.plate) and v.tenant_id = v_t
    join customers cu on cu.id = v.customer_id;

  -- Specialist modules (record engine).
  insert into app_records (app, kind, title, stage, data, amount) values
    ('vehicle_yard', 'car', 'Toyota Harrier 2018', 'in_yard', jsonb_build_object('_prefix', 'CAR-', 'make', 'Toyota', 'model', 'Harrier', 'year', 2018, 'mileage', 68000, 'colour', 'Pearl white', 'engine_cc', 2000, 'fuel', 'Petrol', 'transmission', 'Automatic', 'body', 'SUV', 'cost', 2950000, 'min_price', 3350000, 'listed', true, 'location', 'Main yard'), 3600000),
    ('vehicle_yard', 'car', 'Mazda CX-5 2017', 'in_yard', jsonb_build_object('_prefix', 'CAR-', 'make', 'Mazda', 'model', 'CX-5', 'year', 2017, 'mileage', 81000, 'colour', 'Soul red', 'engine_cc', 2200, 'fuel', 'Diesel', 'transmission', 'Automatic', 'body', 'SUV', 'cost', 2300000, 'min_price', 2650000, 'listed', true, 'location', 'Main yard'), 2850000),
    ('vehicle_yard', 'car', 'Toyota Axio 2016', 'reserved', jsonb_build_object('_prefix', 'CAR-', 'make', 'Toyota', 'model', 'Axio', 'year', 2016, 'mileage', 92000, 'colour', 'Silver', 'engine_cc', 1500, 'fuel', 'Hybrid', 'transmission', 'Automatic', 'body', 'Saloon', 'cost', 1250000, 'min_price', 1420000, 'listed', true, 'location', 'Main yard'), 1550000),
    ('vehicle_yard', 'car', 'Subaru Forester 2017', 'prep', jsonb_build_object('_prefix', 'CAR-', 'make', 'Subaru', 'model', 'Forester', 'year', 2017, 'mileage', 74000, 'colour', 'Dark blue', 'engine_cc', 2000, 'fuel', 'Petrol', 'transmission', 'Automatic', 'body', 'SUV', 'cost', 2100000, 'min_price', 2400000, 'listed', false, 'location', 'Workshop'), 2600000),
    ('vehicle_yard', 'car', 'Toyota Hilux Double Cab 2019', 'at_sea', jsonb_build_object('_prefix', 'CAR-', 'make', 'Toyota', 'model', 'Hilux', 'year', 2019, 'mileage', 55000, 'colour', 'White', 'engine_cc', 2400, 'fuel', 'Diesel', 'transmission', 'Manual', 'body', 'Pick-up', 'cost', 3400000, 'min_price', 3900000, 'listed', false), 4200000),
    ('vehicle_yard', 'car', 'Nissan Note 2018', 'sold', jsonb_build_object('_prefix', 'CAR-', 'make', 'Nissan', 'model', 'Note', 'year', 2018, 'mileage', 61000, 'colour', 'Orange', 'engine_cc', 1200, 'fuel', 'Petrol', 'transmission', 'Automatic', 'body', 'Hatchback', 'cost', 820000, 'min_price', 950000, 'listed', false), 1020000),
    ('car_wash', 'package', 'Body wash', null, jsonb_build_object('type', 'Package'), 300),
    ('car_wash', 'package', 'Full wash and vacuum', null, jsonb_build_object('type', 'Package'), 600),
    ('car_wash', 'package', 'Engine wash', null, jsonb_build_object('type', 'Add-on'), 400),
    ('car_wash', 'wash', 'KDN 506E', 'washing', jsonb_build_object('_prefix', 'W-', 'paid', false), 600),
    ('car_wash', 'wash', 'KDP 809H', 'queued', jsonb_build_object('_prefix', 'W-', 'paid', false), 300),
    ('car_wash', 'wash', 'KDQ 910J', 'ready', jsonb_build_object('_prefix', 'W-', 'paid', true), 1000),
    ('car_wash', 'wash', 'KDK 203B', 'collected', jsonb_build_object('_prefix', 'W-', 'paid', true), 600),
    ('body_paint', 'bp_job', 'KDL 607F rear bumper', 'paint', jsonb_build_object('_prefix', 'BP-'), 38000),
    ('towing', 'tow', 'Breakdown on Thika Road', 'dispatched', jsonb_build_object('_prefix', 'TOW-', 'distance_km', 14), 9500),
    ('imports', 'shipment', 'Container of spares', 'at_port', jsonb_build_object('_prefix', 'SHP-'), 0);

  select count(*) into n from garage_jobs where tenant_id = v_t;
  return 'garage demo ready: ' || n || ' job cards';
end $fn$;
revoke all on function public.garage_demo_seed(uuid) from public, anon, authenticated;
grant execute on function public.garage_demo_seed(uuid) to service_role;

/** Puts the demo garage back: clears what visitors made, then fills it again. */
create or replace function public.demo_reset() returns text
language plpgsql security definer set search_path = public as $fn$
declare uid uuid; v_t uuid; tb text; pass int; left_ int;
  keep text[] := array['tenants','business_settings','profiles','tenant_members','tenant_modules','subscriptions','subscription_payments','subscription_reminders',
    'chart_of_accounts','integration_secrets','tenant_domains','tenant_themes','tenant_feature_overrides','tenant_gateways','tenant_messaging','tenant_sms_settings',
    'tenant_sms_topups','tenant_payout_channels','tenant_bank_accounts','sendmoney_tenants','sendmoney_provisioning','document_templates','crm_stages','crm_tags',
    'crm_teams','crm_lost_reasons','crm_activity_types','hr_departments','hr_designations','hr_leave_types','hr_pay_items','hr_holidays','product_categories',
    'product_subcategories','product_units','expense_categories','bill_categories','app_definitions','inventory_settings','cc_settings','cc_queues','locations',
    'feature_audit_logs','user_activity_log','email_logs','tenant_backups','migration_jobs','migration_rows','garage_counters'];
begin
  select id into uid from auth.users where email = 'demo@jmsurf.co.ke';
  if uid is null then return 'no demo user'; end if;
  select tenant_id into v_t from public.profiles where user_id = uid;
  if v_t is null then return 'no demo company'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);

  for pass in 1..8 loop
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
  update public.garage_counters set last_no = 0 where tenant_id = v_t;

  return public.garage_demo_seed(v_t);
end $fn$;
revoke all on function public.demo_reset() from public, anon, authenticated;
grant execute on function public.demo_reset() to service_role;
