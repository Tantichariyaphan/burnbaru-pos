create table if not exists product_modifiers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_satang integer not null default 0 check (price_satang >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists product_modifier_assignments (
  product_id uuid not null references products(id) on delete cascade,
  modifier_id uuid not null references product_modifiers(id) on delete cascade,
  primary key (product_id, modifier_id)
);

create table if not exists discounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount_satang integer check (amount_satang >= 0),
  percentage_bps integer check (percentage_bps between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (num_nonnulls(amount_satang, percentage_bps) = 1)
);

create table if not exists tax_configuration (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  rate_bps integer not null default 0 check (rate_bps between 0 and 10000),
  updated_at timestamptz not null default now()
);
insert into tax_configuration(singleton) values (true) on conflict do nothing;

create table if not exists inventory (
  product_id uuid primary key references products(id) on delete restrict,
  quantity numeric(12, 3) not null default 0 check (quantity >= 0),
  unit text not null default 'unit',
  updated_at timestamptz not null default now()
);

create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete restrict,
  employee_id uuid not null references employees(id),
  shift_id uuid references shifts(id),
  quantity_delta numeric(12, 3) not null check (quantity_delta <> 0),
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists store_settings (
  singleton boolean primary key default true check (singleton),
  store_name text not null default 'BurnBau',
  address text,
  phone text,
  receipt_footer text,
  updated_at timestamptz not null default now()
);
insert into store_settings(singleton) values (true) on conflict do nothing;

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete restrict,
  receipt_no bigint generated always as identity unique,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists shift_closings (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references shifts(id) on delete restrict,
  closed_by uuid not null references employees(id),
  opened_at timestamptz not null,
  closed_at timestamptz not null default now(),
  opening_cash_satang integer not null,
  cash_sales_satang integer not null,
  cash_refunds_satang integer not null,
  cash_in_satang integer not null,
  cash_out_satang integer not null,
  expected_cash_satang integer not null,
  counted_cash_satang integer not null,
  variance_satang integer not null,
  transfer_sales_satang integer not null,
  discount_satang integer not null,
  tax_satang integer not null,
  refunds_satang integer not null,
  net_sales_satang integer not null,
  order_count integer not null,
  notes text
);

alter table orders add column if not exists tax_satang integer not null default 0 check (tax_satang >= 0);
alter table orders add column if not exists idempotency_key uuid;
alter table orders add column if not exists request_fingerprint text;
alter table order_items add column if not exists category_name_snapshot text not null default '';
alter table shifts add column if not exists closing_notes text;
alter table shifts add column if not exists closed_by uuid references employees(id);
alter table shifts add column if not exists closed_at timestamptz;
alter table shifts add column if not exists counted_cash_satang integer;
alter table shifts add column if not exists expected_cash_satang integer;
alter table shifts add column if not exists variance_satang integer;

create unique index if not exists orders_idempotency_key_unique
  on orders(idempotency_key) where idempotency_key is not null;
create unique index if not exists payments_one_per_order on payments(order_id);
create index if not exists orders_created_at_idx on orders(created_at desc);
create index if not exists orders_paid_at_idx on orders(paid_at desc) where paid_at is not null;
create index if not exists payments_shift_method_idx on payments(shift_id, method);
create index if not exists refunds_order_created_idx on refunds(order_id, created_at desc);
create index if not exists cash_movements_shift_created_idx on cash_movements(shift_id, created_at desc);
create index if not exists inventory_movements_product_created_idx on inventory_movements(product_id, created_at desc);

create or replace function current_employee_id()
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select id from employees
  where auth_user_id = (select auth.uid()) and active
  limit 1
$$;

create or replace function current_employee_role()
returns employee_role
language sql stable security definer
set search_path = public, pg_temp
as $$
  select role from employees
  where auth_user_id = (select auth.uid()) and active
  limit 1
$$;

create or replace function assert_active_employee()
returns uuid
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid;
begin
  v_employee_id := current_employee_id();
  if v_employee_id is null then
    raise exception 'An active employee profile is required' using errcode = '42501';
  end if;
  return v_employee_id;
end
$$;

create or replace function employee_directory()
returns table(id uuid, name text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select e.id, e.name from employees e
  where e.active and current_employee_id() is not null
  order by e.name
$$;

alter table employees enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table shifts enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table payments enable row level security;
alter table cash_movements enable row level security;
alter table refunds enable row level security;
alter table audit_logs enable row level security;
alter table product_modifiers enable row level security;
alter table product_modifier_assignments enable row level security;
alter table discounts enable row level security;
alter table tax_configuration enable row level security;
alter table inventory enable row level security;
alter table inventory_movements enable row level security;
alter table customers enable row level security;
alter table store_settings enable row level security;
alter table receipts enable row level security;
alter table shift_closings enable row level security;

create policy employees_read on employees for select to authenticated
  using (id = current_employee_id() or current_employee_role() in ('owner', 'manager'));
create policy categories_read on categories for select to authenticated
  using (current_employee_id() is not null);
create policy products_read on products for select to authenticated
  using (current_employee_id() is not null);
create policy shifts_read on shifts for select to authenticated
  using (current_employee_id() is not null);
create policy orders_read on orders for select to authenticated
  using (current_employee_id() is not null);
create policy order_items_read on order_items for select to authenticated
  using (current_employee_id() is not null);
create policy payments_read on payments for select to authenticated
  using (current_employee_id() is not null);
create policy cash_movements_read on cash_movements for select to authenticated
  using (current_employee_id() is not null);
create policy refunds_read on refunds for select to authenticated
  using (current_employee_id() is not null);
create policy audit_logs_read on audit_logs for select to authenticated
  using (current_employee_role() in ('owner', 'manager'));
create policy modifiers_read on product_modifiers for select to authenticated
  using (current_employee_id() is not null);
create policy modifier_assignments_read on product_modifier_assignments for select to authenticated
  using (current_employee_id() is not null);
create policy discounts_read on discounts for select to authenticated
  using (current_employee_id() is not null);
create policy tax_configuration_read on tax_configuration for select to authenticated
  using (current_employee_id() is not null);
create policy inventory_read on inventory for select to authenticated
  using (current_employee_id() is not null);
create policy inventory_movements_read on inventory_movements for select to authenticated
  using (current_employee_id() is not null);
create policy customers_read on customers for select to authenticated
  using (current_employee_id() is not null);
create policy store_settings_read on store_settings for select to authenticated
  using (current_employee_id() is not null);
create policy receipts_read on receipts for select to authenticated
  using (current_employee_id() is not null);
create policy shift_closings_read on shift_closings for select to authenticated
  using (current_employee_id() is not null);

revoke insert, update, delete on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

create or replace function open_shift(p_opening_cash_satang integer, p_register_id text default 'POS1')
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := assert_active_employee();
  v_shift shifts%rowtype;
begin
  if p_opening_cash_satang < 0 or p_register_id is null or length(trim(p_register_id)) = 0 then
    raise exception 'Opening cash and register are invalid';
  end if;
  insert into shifts(register_id, opened_by, opening_cash_satang)
  values (trim(p_register_id), v_employee_id, p_opening_cash_satang)
  returning * into v_shift;
  insert into audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'shift.opened', 'shift', v_shift.id,
    jsonb_build_object('opening_cash_satang', p_opening_cash_satang));
  return jsonb_build_object('id', v_shift.id, 'opened_at', v_shift.opened_at,
    'opening_cash_satang', v_shift.opening_cash_satang);
end
$$;

create or replace function create_order(
  p_items jsonb,
  p_discount_satang integer default 0,
  p_idempotency_key uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := assert_active_employee();
  v_shift_id uuid;
  v_order_id uuid;
  v_order_no bigint;
  v_fingerprint text;
  v_subtotal integer;
  v_tax integer;
  v_total integer;
  v_tax_enabled boolean;
  v_tax_rate_bps integer;
  v_count integer;
  v_requested_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Order items must be an array';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'Order must contain between 1 and 100 product lines';
  end if;
  if p_discount_satang is null or p_discount_satang < 0 or p_idempotency_key is null then
    raise exception 'Discount and idempotency key are required';
  end if;
  if p_discount_satang > 0 and current_employee_role() not in ('owner', 'manager') then
    raise exception 'Only a manager can apply a discount' using errcode = '42501';
  end if;

  v_fingerprint := md5(p_items::text || ':' || p_discount_satang::text);
  select id, order_no into v_order_id, v_order_no from orders
  where idempotency_key = p_idempotency_key and created_by = v_employee_id;
  if v_order_id is not null then
    if (select request_fingerprint from orders where id = v_order_id) <> v_fingerprint then
      raise exception 'Idempotency key was reused with different order contents';
    end if;
    return (select jsonb_build_object('id', id, 'order_no', order_no,
      'subtotal_satang', subtotal_satang, 'discount_satang', discount_satang,
      'tax_satang', tax_satang, 'total_satang', total_satang)
      from orders where id = v_order_id);
  end if;

  select id into v_shift_id from shifts where status = 'open' order by opened_at desc limit 1 for update;
  if v_shift_id is null then raise exception 'Open a shift before creating an order'; end if;
  select count(*) into v_requested_count
  from (select distinct (value->>'product_id') as product_id
    from jsonb_array_elements(p_items)) requested;
  select count(*) into v_count
  from jsonb_to_recordset(p_items) as line(product_id uuid, quantity integer)
  join products p on p.id = line.product_id and p.active and p.available
  where line.quantity between 1 and 99;
  if v_count <> jsonb_array_length(p_items) or v_count <> v_requested_count then
    raise exception 'One or more products are unavailable or quantities are invalid';
  end if;
  select coalesce(sum(p.price_satang * line.quantity), 0)::integer into v_subtotal
  from jsonb_to_recordset(p_items) as line(product_id uuid, quantity integer)
  join products p on p.id = line.product_id and p.active and p.available;
  if p_discount_satang > v_subtotal then raise exception 'Discount exceeds subtotal'; end if;
  select enabled, rate_bps into v_tax_enabled, v_tax_rate_bps
  from tax_configuration where singleton = true;
  v_tax := case when coalesce(v_tax_enabled, false)
    then round((v_subtotal - p_discount_satang) * v_tax_rate_bps / 10000.0)::integer else 0 end;
  v_total := v_subtotal - p_discount_satang + v_tax;

  insert into orders(shift_id, created_by, subtotal_satang, discount_satang,
    tax_satang, total_satang, idempotency_key, request_fingerprint)
  values (v_shift_id, v_employee_id, v_subtotal, p_discount_satang, v_tax,
    v_total, p_idempotency_key, v_fingerprint)
  returning id, order_no into v_order_id, v_order_no;
  insert into order_items(order_id, product_id, name_snapshot, emoji_snapshot,
    category_name_snapshot, unit_price_satang, quantity, line_total_satang)
  select v_order_id, p.id, p.name, p.emoji, c.name, p.price_satang,
    line.quantity, p.price_satang * line.quantity
  from jsonb_to_recordset(p_items) as line(product_id uuid, quantity integer)
  join products p on p.id = line.product_id
  join categories c on c.id = p.category_id;
  insert into audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'order.created', 'order', v_order_id,
    jsonb_build_object('order_no', v_order_no, 'total_satang', v_total));
  return jsonb_build_object('id', v_order_id, 'order_no', v_order_no,
    'subtotal_satang', v_subtotal, 'discount_satang', p_discount_satang,
    'tax_satang', v_tax, 'total_satang', v_total);
end
$$;

create or replace function update_open_order(
  p_order_id uuid, p_items jsonb, p_discount_satang integer default 0
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := assert_active_employee();
  v_order orders%rowtype;
  v_subtotal integer;
  v_tax integer;
  v_tax_enabled boolean;
  v_tax_rate_bps integer;
  v_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Order items must be an array';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100
     or p_discount_satang is null or p_discount_satang < 0 then
    raise exception 'Order contents or discount are invalid';
  end if;
  select * into v_order from orders where id = p_order_id for update;
  if not found or v_order.status <> 'open' then raise exception 'Order is not editable'; end if;
  if v_order.created_by <> v_employee_id and current_employee_role() not in ('owner', 'manager') then
    raise exception 'Not authorized to edit this order' using errcode = '42501';
  end if;
  if p_discount_satang > 0 and current_employee_role() not in ('owner', 'manager') then
    raise exception 'Only a manager can apply a discount' using errcode = '42501';
  end if;
  select count(*) into v_count
  from jsonb_to_recordset(p_items) as line(product_id uuid, quantity integer)
  join products p on p.id = line.product_id and p.active and p.available
  where line.quantity between 1 and 99;
  if v_count <> jsonb_array_length(p_items) then raise exception 'Invalid product or quantity'; end if;
  select coalesce(sum(p.price_satang * line.quantity), 0)::integer into v_subtotal
  from jsonb_to_recordset(p_items) as line(product_id uuid, quantity integer)
  join products p on p.id = line.product_id and p.active and p.available;
  if p_discount_satang > v_subtotal then raise exception 'Discount exceeds subtotal'; end if;
  select enabled, rate_bps into v_tax_enabled, v_tax_rate_bps
  from tax_configuration where singleton = true;
  v_tax := case when coalesce(v_tax_enabled, false)
    then round((v_subtotal - p_discount_satang) * v_tax_rate_bps / 10000.0)::integer else 0 end;
  delete from order_items where order_id = p_order_id;
  insert into order_items(order_id, product_id, name_snapshot, emoji_snapshot,
    category_name_snapshot, unit_price_satang, quantity, line_total_satang)
  select p_order_id, p.id, p.name, p.emoji, c.name, p.price_satang,
    line.quantity, p.price_satang * line.quantity
  from jsonb_to_recordset(p_items) as line(product_id uuid, quantity integer)
  join products p on p.id = line.product_id
  join categories c on c.id = p.category_id;
  update orders set subtotal_satang = v_subtotal, discount_satang = p_discount_satang,
    tax_satang = v_tax, total_satang = v_subtotal - p_discount_satang + v_tax,
    updated_at = now() where id = p_order_id;
  return (select jsonb_build_object('id', id, 'order_no', order_no,
    'subtotal_satang', subtotal_satang, 'discount_satang', discount_satang,
    'tax_satang', tax_satang, 'total_satang', total_satang)
    from orders where id = p_order_id);
end
$$;

create or replace function checkout_order(
  p_order_id uuid, p_method payment_method, p_received_satang integer,
  p_reference text, p_idempotency_key uuid
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := assert_active_employee();
  v_order orders%rowtype;
  v_payment payments%rowtype;
  v_receipt_id uuid;
  v_existing payments%rowtype;
begin
  select * into v_existing from payments where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.order_id <> p_order_id then raise exception 'Idempotency key belongs to another order'; end if;
    return jsonb_build_object('payment_id', v_existing.id, 'order_id', v_existing.order_id,
      'receipt_id', (select id from receipts where order_id = p_order_id));
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found or v_order.status <> 'open' then raise exception 'Order is not payable'; end if;
  if v_order.created_by <> v_employee_id and current_employee_role() not in ('owner', 'manager') then
    raise exception 'Not authorized to pay this order' using errcode = '42501';
  end if;
  if p_method = 'cash' and (p_received_satang is null or p_received_satang < v_order.total_satang) then
    raise exception 'Cash received is less than the order total';
  end if;
  if p_method = 'bank_transfer' and (p_received_satang is null or p_received_satang <> v_order.total_satang) then
    raise exception 'Transfer amount must equal the order total';
  end if;
  insert into payments(order_id, shift_id, method, amount_satang, received_satang,
    change_satang, reference, idempotency_key, created_by)
  values (v_order.id, v_order.shift_id, p_method, v_order.total_satang,
    p_received_satang, greatest(p_received_satang - v_order.total_satang, 0),
    nullif(trim(p_reference), ''), p_idempotency_key, v_employee_id)
  returning * into v_payment;
  update orders set status = 'preparing', payment_method = p_method, paid_at = now(),
    updated_at = now() where id = v_order.id;
  insert into receipts(order_id, snapshot)
  select v_order.id, jsonb_build_object(
    'order_no', v_order.order_no, 'created_at', v_order.created_at, 'paid_at', now(),
    'employee_name', e.name, 'subtotal_satang', v_order.subtotal_satang,
    'discount_satang', v_order.discount_satang, 'tax_satang', v_order.tax_satang,
    'total_satang', v_order.total_satang, 'payment_method', p_method,
    'reference', nullif(trim(p_reference), ''),
    'items', coalesce(jsonb_agg(jsonb_build_object('name', oi.name_snapshot,
      'emoji', oi.emoji_snapshot, 'quantity', oi.quantity,
      'unit_price_satang', oi.unit_price_satang,
      'line_total_satang', oi.line_total_satang)), '[]'::jsonb))
  from employees e cross join order_items oi
  where e.id = v_order.created_by and oi.order_id = v_order.id
  group by e.name;
  select id into v_receipt_id from receipts where order_id = v_order.id;
  insert into audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'order.paid', 'order', v_order.id,
    jsonb_build_object('payment_id', v_payment.id, 'amount_satang', v_payment.amount_satang,
      'method', p_method, 'receipt_id', v_receipt_id));
  return jsonb_build_object('payment_id', v_payment.id, 'order_id', v_order.id,
    'receipt_id', v_receipt_id, 'change_satang', v_payment.change_satang);
end
$$;

create or replace function record_cash_movement(
  p_type cash_move_type, p_channel pay_channel, p_amount_satang integer,
  p_reason text, p_note text default null
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := assert_active_employee();
  v_shift_id uuid;
  v_id uuid;
begin
  if p_type not in ('in', 'out') or p_amount_satang <= 0
     or length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Cash movement type, amount and reason are required';
  end if;
  select id into v_shift_id from shifts where status = 'open' order by opened_at desc limit 1 for update;
  if v_shift_id is null then raise exception 'There is no open shift'; end if;
  insert into cash_movements(shift_id, employee_id, type, channel,
    amount_satang, reason, note)
  values (v_shift_id, v_employee_id, p_type, p_channel, p_amount_satang,
    trim(p_reason), nullif(trim(p_note), '')) returning id into v_id;
  insert into audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'cash_movement.recorded', 'cash_movement', v_id,
    jsonb_build_object('shift_id', v_shift_id, 'type', p_type,
      'channel', p_channel, 'amount_satang', p_amount_satang, 'reason', p_reason));
  return jsonb_build_object('id', v_id, 'shift_id', v_shift_id);
end
$$;

create or replace function mark_order_done(p_order_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := assert_active_employee();
  v_status order_status;
begin
  select status into v_status from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_status = 'completed' then return jsonb_build_object('id', p_order_id, 'status', v_status); end if;
  if v_status <> 'preparing' then raise exception 'Only paid orders can be completed'; end if;
  update orders set status = 'completed', updated_at = now() where id = p_order_id;
  insert into audit_logs(employee_id, action, entity, entity_id)
  values (v_employee_id, 'order.completed', 'order', p_order_id);
  return jsonb_build_object('id', p_order_id, 'status', 'completed');
end
$$;

create or replace function cancel_open_order(p_order_id uuid, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := assert_active_employee();
  v_order orders%rowtype;
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Cancellation reason is required'; end if;
  select * into v_order from orders where id = p_order_id for update;
  if not found or v_order.status <> 'open' then raise exception 'Only unpaid orders can be cancelled'; end if;
  if v_order.created_by <> v_employee_id and current_employee_role() not in ('owner', 'manager') then
    raise exception 'Not authorized to cancel this order' using errcode = '42501';
  end if;
  update orders set status = 'cancelled', notes = trim(p_reason), updated_at = now() where id = p_order_id;
  insert into audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'order.cancelled', 'order', p_order_id, jsonb_build_object('reason', trim(p_reason)));
  return jsonb_build_object('id', p_order_id, 'status', 'cancelled');
end
$$;

create or replace function refund_order(
  p_order_id uuid, p_amount_satang integer, p_reason text
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := assert_active_employee();
  v_role employee_role := current_employee_role();
  v_shift_id uuid;
  v_method payment_method;
  v_paid integer;
  v_refunded integer;
  v_refund_id uuid;
begin
  if v_role not in ('owner', 'manager') then
    raise exception 'Only a manager can issue refunds' using errcode = '42501';
  end if;
  if p_amount_satang <= 0 or length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Refund amount and reason are required';
  end if;
  select id into v_shift_id from shifts where status = 'open' order by opened_at desc limit 1 for update;
  if v_shift_id is null then raise exception 'Open a shift before issuing a refund'; end if;
  select p.method, p.amount_satang into v_method, v_paid
  from payments p join orders o on o.id = p.order_id
  where o.id = p_order_id and o.status in ('preparing', 'completed') for update of o, p;
  if not found then raise exception 'Paid order not found'; end if;
  select coalesce(sum(amount_satang), 0)::integer into v_refunded from refunds where order_id = p_order_id;
  if v_refunded + p_amount_satang > v_paid then raise exception 'Refund exceeds remaining paid amount'; end if;
  insert into refunds(order_id, shift_id, employee_id, channel, amount_satang, reason)
  values (p_order_id, v_shift_id, v_employee_id, v_method, p_amount_satang, trim(p_reason))
  returning id into v_refund_id;
  insert into audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'order.refunded', 'refund', v_refund_id,
    jsonb_build_object('order_id', p_order_id, 'amount_satang', p_amount_satang,
      'channel', v_method, 'reason', trim(p_reason)));
  return jsonb_build_object('refund_id', v_refund_id, 'order_id', p_order_id,
    'amount_satang', p_amount_satang, 'channel', v_method);
end
$$;

create or replace function close_shift(p_shift_id uuid, p_counted_cash_satang integer, p_notes text default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := assert_active_employee();
  v_shift shifts%rowtype;
  v_cash_sales integer;
  v_cash_refunds integer;
  v_cash_in integer;
  v_cash_out integer;
  v_transfer_sales integer;
  v_discounts integer;
  v_tax integer;
  v_refunds integer;
  v_order_count integer;
  v_expected integer;
  v_net_sales integer;
  v_closed_at timestamptz := now();
  v_result shift_closings%rowtype;
begin
  if p_counted_cash_satang < 0 then raise exception 'Counted cash cannot be negative'; end if;
  select * into v_shift from shifts where id = p_shift_id for update;
  if not found or v_shift.status <> 'open' then raise exception 'Shift is not open'; end if;
  if v_shift.opened_by <> v_employee_id and current_employee_role() not in ('owner', 'manager') then
    raise exception 'Not authorized to close this shift' using errcode = '42501';
  end if;
  select coalesce(sum(amount_satang) filter (where method = 'cash'), 0),
    coalesce(sum(amount_satang) filter (where method = 'bank_transfer'), 0)
  into v_cash_sales, v_transfer_sales from payments where shift_id = p_shift_id;
  select coalesce(sum(amount_satang) filter (where channel = 'cash'), 0),
    coalesce(sum(amount_satang), 0)
  into v_cash_refunds, v_refunds from refunds where shift_id = p_shift_id;
  select coalesce(sum(amount_satang) filter (where type = 'in' and channel = 'cash'), 0),
    coalesce(sum(amount_satang) filter (where type = 'out' and channel = 'cash'), 0)
  into v_cash_in, v_cash_out from cash_movements where shift_id = p_shift_id;
  select coalesce(sum(o.discount_satang), 0), coalesce(sum(o.tax_satang), 0), count(*)
  into v_discounts, v_tax, v_order_count
  from orders o join payments p on p.order_id = o.id where o.shift_id = p_shift_id;
  v_expected := v_shift.opening_cash_satang + v_cash_sales - v_cash_refunds + v_cash_in - v_cash_out;
  v_net_sales := v_cash_sales + v_transfer_sales - v_refunds;
  insert into shift_closings(shift_id, closed_by, opened_at, closed_at,
    opening_cash_satang, cash_sales_satang, cash_refunds_satang, cash_in_satang,
    cash_out_satang, expected_cash_satang, counted_cash_satang, variance_satang,
    transfer_sales_satang, discount_satang, tax_satang, refunds_satang,
    net_sales_satang, order_count, notes)
  values (p_shift_id, v_employee_id, v_shift.opened_at, v_closed_at,
    v_shift.opening_cash_satang, v_cash_sales, v_cash_refunds, v_cash_in,
    v_cash_out, v_expected, p_counted_cash_satang, p_counted_cash_satang - v_expected,
    v_transfer_sales, v_discounts, v_tax, v_refunds, v_net_sales, v_order_count,
    nullif(trim(p_notes), '')) returning * into v_result;
  update shifts set status = 'closed', closed_by = v_employee_id, closed_at = v_closed_at,
    counted_cash_satang = p_counted_cash_satang, expected_cash_satang = v_expected,
    variance_satang = p_counted_cash_satang - v_expected, closing_notes = nullif(trim(p_notes), '')
  where id = p_shift_id;
  insert into audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'shift.closed', 'shift', p_shift_id,
    jsonb_build_object('expected_cash_satang', v_expected,
      'counted_cash_satang', p_counted_cash_satang,
      'variance_satang', p_counted_cash_satang - v_expected));
  return to_jsonb(v_result);
end
$$;

revoke all on function current_employee_id() from public, anon;
revoke all on function current_employee_role() from public, anon;
revoke all on function assert_active_employee() from public, anon;
revoke all on function employee_directory() from public, anon;
revoke all on function open_shift(integer, text) from public, anon;
revoke all on function create_order(jsonb, integer, uuid) from public, anon;
revoke all on function update_open_order(uuid, jsonb, integer) from public, anon;
revoke all on function checkout_order(uuid, payment_method, integer, text, uuid) from public, anon;
revoke all on function record_cash_movement(cash_move_type, pay_channel, integer, text, text) from public, anon;
revoke all on function mark_order_done(uuid) from public, anon;
revoke all on function cancel_open_order(uuid, text) from public, anon;
revoke all on function refund_order(uuid, integer, text) from public, anon;
revoke all on function close_shift(uuid, integer, text) from public, anon;
grant execute on function current_employee_id() to authenticated;
grant execute on function current_employee_role() to authenticated;
grant execute on function employee_directory() to authenticated;
grant execute on function open_shift(integer, text) to authenticated;
grant execute on function create_order(jsonb, integer, uuid) to authenticated;
grant execute on function update_open_order(uuid, jsonb, integer) to authenticated;
grant execute on function checkout_order(uuid, payment_method, integer, text, uuid) to authenticated;
grant execute on function record_cash_movement(cash_move_type, pay_channel, integer, text, text) to authenticated;
grant execute on function mark_order_done(uuid) to authenticated;
grant execute on function cancel_open_order(uuid, text) to authenticated;
grant execute on function refund_order(uuid, integer, text) to authenticated;
grant execute on function close_shift(uuid, integer, text) to authenticated;
