create or replace function public.add_pos_product(
  p_category_id uuid,
  p_name text,
  p_emoji text,
  p_price_satang integer,
  p_available boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_employee_id uuid := public.assert_active_employee();
  v_product public.products%rowtype;
  v_name text := nullif(trim(p_name), '');
  v_emoji text := nullif(trim(p_emoji), '');
begin
  if public.current_employee_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can add products' using errcode = '42501';
  end if;

  if p_category_id is null or v_name is null or length(v_name) > 120
     or p_price_satang is null or p_price_satang <= 0
     or v_emoji is not null and length(v_emoji) > 16 then
    raise exception 'Product details are invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'burnbaru-pos-product:' || p_category_id::text || ':' || lower(v_name), 0
  ));

  perform 1
  from public.categories
  where id = p_category_id and active
  for update;
  if not found then
    raise exception 'Choose an active product category';
  end if;

  if exists (
    select 1
    from public.products
    where category_id = p_category_id
      and active
      and lower(trim(name)) = lower(v_name)
  ) then
    raise exception 'A product with this name already exists in the category';
  end if;

  insert into public.products(
    category_id, name, emoji, price_satang, available, active, sort_order
  )
  values (
    p_category_id, v_name, v_emoji, p_price_satang, coalesce(p_available, true), true,
    coalesce((select max(sort_order) + 1 from public.products where category_id = p_category_id), 0)
  )
  returning * into v_product;

  insert into public.audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'product.created', 'product', v_product.id,
    jsonb_build_object(
      'category_id', v_product.category_id,
      'name', v_product.name,
      'price_satang', v_product.price_satang,
      'available', v_product.available
    ));

  return jsonb_build_object(
    'id', v_product.id,
    'category_id', v_product.category_id,
    'name', v_product.name,
    'emoji', v_product.emoji,
    'price_satang', v_product.price_satang,
    'available', v_product.available,
    'sort_order', v_product.sort_order
  );
end
$$;

create or replace function public.create_order(
  p_items jsonb,
  p_discount_satang integer default 0,
  p_idempotency_key uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_employee_id uuid := public.assert_active_employee();
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
  if p_discount_satang > 0 and public.current_employee_role() not in ('owner', 'manager') then
    raise exception 'Only a manager can apply a discount' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'burnbaru-pos-order:' || v_employee_id::text || ':' || p_idempotency_key::text, 0
  ));

  v_fingerprint := md5(p_items::text || ':' || p_discount_satang::text);
  select id, order_no into v_order_id, v_order_no
  from public.orders
  where idempotency_key = p_idempotency_key and created_by = v_employee_id;
  if v_order_id is not null then
    if (select request_fingerprint from public.orders where id = v_order_id) <> v_fingerprint then
      raise exception 'Idempotency key was reused with different order contents';
    end if;
    return (
      select jsonb_build_object(
        'id', id, 'order_no', order_no, 'subtotal_satang', subtotal_satang,
        'discount_satang', discount_satang, 'tax_satang', tax_satang,
        'total_satang', total_satang
      )
      from public.orders where id = v_order_id
    );
  end if;

  select id into v_shift_id
  from public.shifts
  where register_id = 'POS1' and status = 'open'
  limit 1
  for update;
  if v_shift_id is null then raise exception 'Open a shift before creating an order'; end if;

  select count(*) into v_requested_count
  from (
    select distinct value->>'product_id' as product_id
    from jsonb_array_elements(p_items)
  ) as requested;

  select count(*) into v_count
  from jsonb_to_recordset(p_items) as line(product_id uuid, quantity integer)
  join public.products as p on p.id = line.product_id and p.active and p.available
  where line.quantity between 1 and 99;
  if v_count <> jsonb_array_length(p_items) or v_count <> v_requested_count then
    raise exception 'One or more products are unavailable or quantities are invalid';
  end if;

  select coalesce(sum(p.price_satang * line.quantity), 0)::integer into v_subtotal
  from jsonb_to_recordset(p_items) as line(product_id uuid, quantity integer)
  join public.products as p on p.id = line.product_id and p.active and p.available;
  if p_discount_satang > v_subtotal then raise exception 'Discount exceeds subtotal'; end if;

  select enabled, rate_bps into v_tax_enabled, v_tax_rate_bps
  from public.tax_configuration where singleton = true;
  v_tax := case
    when coalesce(v_tax_enabled, false)
      then round((v_subtotal - p_discount_satang) * v_tax_rate_bps / 10000.0)::integer
    else 0
  end;
  v_total := v_subtotal - p_discount_satang + v_tax;

  insert into public.orders(
    shift_id, created_by, subtotal_satang, discount_satang, tax_satang,
    total_satang, idempotency_key, request_fingerprint
  )
  values (
    v_shift_id, v_employee_id, v_subtotal, p_discount_satang, v_tax,
    v_total, p_idempotency_key, v_fingerprint
  )
  returning id, order_no into v_order_id, v_order_no;

  insert into public.order_items(
    order_id, product_id, name_snapshot, emoji_snapshot, category_name_snapshot,
    unit_price_satang, quantity, line_total_satang
  )
  select v_order_id, p.id, p.name, p.emoji, c.name, p.price_satang,
    line.quantity, p.price_satang * line.quantity
  from jsonb_to_recordset(p_items) as line(product_id uuid, quantity integer)
  join public.products as p on p.id = line.product_id
  join public.categories as c on c.id = p.category_id;

  insert into public.audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'order.created', 'order', v_order_id,
    jsonb_build_object('order_no', v_order_no, 'total_satang', v_total));

  return jsonb_build_object(
    'id', v_order_id, 'order_no', v_order_no, 'subtotal_satang', v_subtotal,
    'discount_satang', p_discount_satang, 'tax_satang', v_tax, 'total_satang', v_total
  );
end
$$;

create or replace function public.checkout_order(
  p_order_id uuid,
  p_method public.payment_method,
  p_received_satang integer,
  p_reference text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_employee_id uuid := public.assert_active_employee();
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_receipt_id uuid;
  v_existing public.payments%rowtype;
  v_reference text := nullif(trim(p_reference), '');
begin
  if p_order_id is null or p_method is null or p_received_satang is null or p_idempotency_key is null then
    raise exception 'Payment details are required';
  end if;
  if length(coalesce(v_reference, '')) > 120 then
    raise exception 'Payment reference is too long';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'burnbaru-pos-checkout:' || p_idempotency_key::text, 0
  ));

  select * into v_existing
  from public.payments
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.order_id <> p_order_id
       or v_existing.method <> p_method
       or v_existing.received_satang is distinct from p_received_satang
       or v_existing.reference is distinct from v_reference then
      raise exception 'Checkout idempotency key was reused with different payment details';
    end if;
    return jsonb_build_object(
      'payment_id', v_existing.id,
      'order_id', v_existing.order_id,
      'receipt_id', (select id from public.receipts where order_id = p_order_id),
      'change_satang', v_existing.change_satang
    );
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found or v_order.status <> 'open' then raise exception 'Order is not payable'; end if;
  if v_order.created_by <> v_employee_id
     and public.current_employee_role() not in ('owner', 'manager') then
    raise exception 'Not authorized to pay this order' using errcode = '42501';
  end if;

  perform 1
  from public.shifts
  where id = v_order.shift_id and register_id = 'POS1' and status = 'open'
  for update;
  if not found then raise exception 'The order shift is closed'; end if;
  if p_method = 'cash' and p_received_satang < v_order.total_satang then
    raise exception 'Cash received is less than the order total';
  end if;
  if p_method = 'bank_transfer' and p_received_satang <> v_order.total_satang then
    raise exception 'Transfer amount must equal the order total';
  end if;

  insert into public.payments(
    order_id, shift_id, method, amount_satang, received_satang, change_satang,
    reference, idempotency_key, created_by
  )
  values (
    v_order.id, v_order.shift_id, p_method, v_order.total_satang,
    p_received_satang, greatest(p_received_satang - v_order.total_satang, 0),
    v_reference, p_idempotency_key, v_employee_id
  )
  returning * into v_payment;

  update public.orders
  set status = 'preparing', payment_method = p_method, paid_at = now(), updated_at = now()
  where id = v_order.id;

  insert into public.receipts(order_id, snapshot)
  select v_order.id, jsonb_build_object(
    'order_no', v_order.order_no, 'created_at', v_order.created_at, 'paid_at', now(),
    'employee_name', e.name, 'subtotal_satang', v_order.subtotal_satang,
    'discount_satang', v_order.discount_satang, 'tax_satang', v_order.tax_satang,
    'total_satang', v_order.total_satang, 'payment_method', p_method,
    'reference', v_reference,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'name', oi.name_snapshot, 'emoji', oi.emoji_snapshot, 'quantity', oi.quantity,
      'unit_price_satang', oi.unit_price_satang, 'line_total_satang', oi.line_total_satang
    )), '[]'::jsonb)
  )
  from public.employees as e
  cross join public.order_items as oi
  where e.id = v_order.created_by and oi.order_id = v_order.id
  group by e.name;

  select id into v_receipt_id from public.receipts where order_id = v_order.id;
  insert into public.audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'order.paid', 'order', v_order.id,
    jsonb_build_object(
      'payment_id', v_payment.id, 'amount_satang', v_payment.amount_satang,
      'method', p_method, 'receipt_id', v_receipt_id
    ));

  return jsonb_build_object(
    'payment_id', v_payment.id, 'order_id', v_order.id,
    'receipt_id', v_receipt_id, 'change_satang', v_payment.change_satang
  );
end
$$;

create or replace function public.record_cash_movement(
  p_type public.cash_move_type,
  p_channel public.pay_channel,
  p_amount_satang integer,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_employee_id uuid := public.assert_active_employee();
  v_shift_id uuid;
  v_id uuid;
begin
  if p_type not in ('in', 'out') or p_channel is null
     or p_amount_satang is null or p_amount_satang <= 0
     or length(trim(coalesce(p_reason, ''))) < 2
     or length(p_reason) > 180
     or length(coalesce(p_note, '')) > 500 then
    raise exception 'Cash movement type, amount and reason are required';
  end if;

  select id into v_shift_id
  from public.shifts
  where register_id = 'POS1' and status = 'open'
  order by opened_at desc
  limit 1
  for update;
  if v_shift_id is null then raise exception 'There is no open shift'; end if;

  insert into public.cash_movements(
    shift_id, employee_id, type, channel, amount_satang, reason, note
  )
  values (
    v_shift_id, v_employee_id, p_type, p_channel, p_amount_satang,
    trim(p_reason), nullif(trim(p_note), '')
  )
  returning id into v_id;

  insert into public.audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'cash_movement.recorded', 'cash_movement', v_id,
    jsonb_build_object(
      'shift_id', v_shift_id, 'type', p_type, 'channel', p_channel,
      'amount_satang', p_amount_satang, 'reason', p_reason
    ));

  return jsonb_build_object('id', v_id, 'shift_id', v_shift_id);
end
$$;

create or replace function public.refund_order(
  p_order_id uuid,
  p_amount_satang integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_employee_id uuid := public.assert_active_employee();
  v_role public.employee_role := public.current_employee_role();
  v_shift_id uuid;
  v_method public.payment_method;
  v_paid integer;
  v_refunded integer;
  v_refund_id uuid;
begin
  if v_role not in ('owner', 'manager') then
    raise exception 'Only a manager can issue refunds' using errcode = '42501';
  end if;
  if p_order_id is null or p_amount_satang is null or p_amount_satang <= 0
     or length(trim(coalesce(p_reason, ''))) < 2 or length(p_reason) > 180 then
    raise exception 'Refund amount and reason are required';
  end if;

  select id into v_shift_id
  from public.shifts
  where register_id = 'POS1' and status = 'open'
  order by opened_at desc
  limit 1
  for update;
  if v_shift_id is null then raise exception 'Open a shift before issuing a refund'; end if;

  select p.method, p.amount_satang into v_method, v_paid
  from public.payments as p
  join public.orders as o on o.id = p.order_id
  where o.id = p_order_id and o.status in ('preparing', 'completed')
  for update of o, p;
  if not found then raise exception 'Paid order not found'; end if;

  select coalesce(sum(amount_satang), 0)::integer into v_refunded
  from public.refunds where order_id = p_order_id;
  if v_refunded + p_amount_satang > v_paid then
    raise exception 'Refund exceeds remaining paid amount';
  end if;

  insert into public.refunds(order_id, shift_id, employee_id, channel, amount_satang, reason)
  values (p_order_id, v_shift_id, v_employee_id, v_method, p_amount_satang, trim(p_reason))
  returning id into v_refund_id;

  insert into public.audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'order.refunded', 'refund', v_refund_id,
    jsonb_build_object(
      'order_id', p_order_id, 'amount_satang', p_amount_satang,
      'channel', v_method, 'reason', trim(p_reason)
    ));

  return jsonb_build_object(
    'refund_id', v_refund_id, 'order_id', p_order_id,
    'amount_satang', p_amount_satang, 'channel', v_method
  );
end
$$;

revoke all on function public.add_pos_product(uuid, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.create_order(jsonb, integer, uuid) from public, anon, authenticated;
revoke all on function public.checkout_order(uuid, public.payment_method, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.record_cash_movement(public.cash_move_type, public.pay_channel, integer, text, text) from public, anon, authenticated;
revoke all on function public.refund_order(uuid, integer, text) from public, anon, authenticated;

grant execute on function public.add_pos_product(uuid, text, text, integer, boolean) to authenticated;
grant execute on function public.create_order(jsonb, integer, uuid) to authenticated;
grant execute on function public.checkout_order(uuid, public.payment_method, integer, text, uuid) to authenticated;
grant execute on function public.record_cash_movement(public.cash_move_type, public.pay_channel, integer, text, text) to authenticated;
grant execute on function public.refund_order(uuid, integer, text) to authenticated;

notify pgrst, 'reload schema';
