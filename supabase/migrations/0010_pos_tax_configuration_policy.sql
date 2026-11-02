create or replace function public.pos_tax_configuration(p_lock boolean default false)
returns table(enabled boolean, rate_bps integer, fallback_applied boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_active_employee();

  if p_lock then
    return query
    select tc.enabled, tc.rate_bps, false
    from public.tax_configuration as tc
    where tc.singleton = true
    for share;
  else
    return query
    select tc.enabled, tc.rate_bps, false
    from public.tax_configuration as tc
    where tc.singleton = true;
  end if;

  if not found then
    return query select false, 0, true;
  end if;
end
$$;

revoke all on function public.pos_tax_configuration(boolean) from public, anon, authenticated;
grant execute on function public.pos_tax_configuration(boolean) to authenticated;

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

  select tax.enabled, tax.rate_bps into v_tax_enabled, v_tax_rate_bps
  from public.pos_tax_configuration(true) as tax;

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

  select tax.enabled, tax.rate_bps into v_tax_enabled, v_tax_rate_bps
  from public.pos_tax_configuration(true) as tax;

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

notify pgrst, 'reload schema';
