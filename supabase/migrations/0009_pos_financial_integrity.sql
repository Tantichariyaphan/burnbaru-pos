-- Harden financially sensitive RPCs without changing existing business rows.
alter table public.refunds
  add column if not exists sale_payment_method public.payment_method;

alter function public.current_employee_id()
  set search_path = pg_catalog, public, pg_temp;
alter function public.current_employee_role()
  set search_path = pg_catalog, public, pg_temp;
alter function public.assert_active_employee()
  set search_path = pg_catalog, public, pg_temp;
alter function public.employee_directory()
  set search_path = pg_catalog, public, pg_temp;
alter function public.current_employee_profile()
  set search_path = pg_catalog, public, pg_temp;
alter function public.open_shift(integer, text)
  set search_path = pg_catalog, public, pg_temp;
alter function public.checkout_order(uuid, public.payment_method, integer, text, uuid)
  set search_path = pg_catalog, public, pg_temp;
alter function public.record_cash_movement(public.cash_move_type, public.pay_channel, integer, text, text)
  set search_path = pg_catalog, public, pg_temp;
alter function public.mark_order_done(uuid)
  set search_path = pg_catalog, public, pg_temp;
alter function public.cancel_open_order(uuid, text)
  set search_path = pg_catalog, public, pg_temp;
alter function public.refund_order(uuid, integer, text)
  set search_path = pg_catalog, public, pg_temp;
alter function public.close_shift(uuid, integer, text)
  set search_path = pg_catalog, public, pg_temp;

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
  from public.tax_configuration
  where singleton = true
  for share;
  if not found then raise exception 'Tax configuration is missing'; end if;

  v_tax := case
    when v_tax_enabled then round((v_subtotal - p_discount_satang) * v_tax_rate_bps / 10000.0)::integer
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

create or replace function public.update_open_order(
  p_order_id uuid,
  p_items jsonb,
  p_discount_satang integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_employee_id uuid := public.assert_active_employee();
  v_order public.orders%rowtype;
  v_subtotal integer;
  v_tax integer;
  v_tax_enabled boolean;
  v_tax_rate_bps integer;
  v_count integer;
  v_requested_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Order items must be an array';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100
     or p_discount_satang is null or p_discount_satang < 0 then
    raise exception 'Order contents or discount are invalid';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'open' then raise exception 'Order is not editable'; end if;
  if v_order.created_by <> v_employee_id
     and public.current_employee_role() not in ('owner', 'manager') then
    raise exception 'Not authorized to edit this order' using errcode = '42501';
  end if;
  perform 1 from public.shifts where id = v_order.shift_id and status = 'open' for update;
  if not found then raise exception 'The order shift is closed'; end if;
  if p_discount_satang > 0 and public.current_employee_role() not in ('owner', 'manager') then
    raise exception 'Only a manager can apply a discount' using errcode = '42501';
  end if;

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
  from public.tax_configuration
  where singleton = true
  for share;
  if not found then raise exception 'Tax configuration is missing'; end if;

  v_tax := case
    when v_tax_enabled then round((v_subtotal - p_discount_satang) * v_tax_rate_bps / 10000.0)::integer
    else 0
  end;

  delete from public.order_items where order_id = p_order_id;
  insert into public.order_items(
    order_id, product_id, name_snapshot, emoji_snapshot, category_name_snapshot,
    unit_price_satang, quantity, line_total_satang
  )
  select p_order_id, p.id, p.name, p.emoji, c.name, p.price_satang,
    line.quantity, p.price_satang * line.quantity
  from jsonb_to_recordset(p_items) as line(product_id uuid, quantity integer)
  join public.products as p on p.id = line.product_id
  join public.categories as c on c.id = p.category_id;

  update public.orders
  set subtotal_satang = v_subtotal, discount_satang = p_discount_satang,
      tax_satang = v_tax, total_satang = v_subtotal - p_discount_satang + v_tax,
      updated_at = now()
  where id = p_order_id;

  return (
    select jsonb_build_object(
      'id', id, 'order_no', order_no, 'subtotal_satang', subtotal_satang,
      'discount_satang', discount_satang, 'tax_satang', tax_satang,
      'total_satang', total_satang
    )
    from public.orders where id = p_order_id
  );
end
$$;

create or replace function public.refund_order(
  p_order_id uuid,
  p_amount_satang integer,
  p_channel public.pay_channel,
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
  v_paid integer;
  v_sale_payment_method public.payment_method;
  v_refunded integer;
  v_refund_id uuid;
  v_reason text := nullif(trim(p_reason), '');
begin
  if v_role not in ('owner', 'manager') then
    raise exception 'Only a manager can issue refunds' using errcode = '42501';
  end if;
  if p_order_id is null or p_amount_satang is null or p_amount_satang <= 0
     or p_channel is null or v_reason is null or length(v_reason) < 2 or length(v_reason) > 180 then
    raise exception 'Refund amount, channel, and reason are required';
  end if;

  select id into v_shift_id
  from public.shifts
  where register_id = 'POS1' and status = 'open'
  order by opened_at desc
  limit 1
  for update;
  if v_shift_id is null then raise exception 'Open a shift before issuing a refund'; end if;

  select p.amount_satang, p.method into v_paid, v_sale_payment_method
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

  insert into public.refunds(
    order_id, shift_id, employee_id, channel, sale_payment_method, amount_satang, reason
  )
  values (
    p_order_id, v_shift_id, v_employee_id, p_channel, v_sale_payment_method, p_amount_satang, v_reason
  )
  returning id into v_refund_id;

  insert into public.audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'order.refunded', 'refund', v_refund_id,
    jsonb_build_object(
      'order_id', p_order_id, 'amount_satang', p_amount_satang,
      'channel', p_channel, 'reason', v_reason
    ));

  return jsonb_build_object(
    'refund_id', v_refund_id, 'order_id', p_order_id,
    'amount_satang', p_amount_satang, 'channel', p_channel
  );
end
$$;

revoke all on function public.refund_order(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.refund_order(uuid, integer, public.pay_channel, text) from public, anon, authenticated;
grant execute on function public.refund_order(uuid, integer, public.pay_channel, text) to authenticated;

notify pgrst, 'reload schema';
