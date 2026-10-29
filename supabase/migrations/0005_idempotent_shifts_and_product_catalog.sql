create or replace function public.open_shift(
  p_opening_cash_satang integer,
  p_register_id text default 'POS1'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_employee_id uuid := public.assert_active_employee();
  v_register_id text := nullif(trim(p_register_id), '');
  v_shift public.shifts%rowtype;
begin
  if p_opening_cash_satang is null or p_opening_cash_satang < 0
     or v_register_id is null or length(v_register_id) > 40 then
    raise exception 'Opening cash and register are invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('burnbaru-pos-shift:' || v_register_id));

  select * into v_shift
  from public.shifts
  where register_id = v_register_id and status = 'open'
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'id', v_shift.id,
      'opened_at', v_shift.opened_at,
      'opening_cash_satang', v_shift.opening_cash_satang,
      'already_open', true
    );
  end if;

  insert into public.shifts(register_id, opened_by, opening_cash_satang)
  values (v_register_id, v_employee_id, p_opening_cash_satang)
  returning * into v_shift;

  insert into public.audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'shift.opened', 'shift', v_shift.id,
    jsonb_build_object('opening_cash_satang', p_opening_cash_satang));

  return jsonb_build_object(
    'id', v_shift.id,
    'opened_at', v_shift.opened_at,
    'opening_cash_satang', v_shift.opening_cash_satang,
    'already_open', false
  );
end
$$;

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
begin
  if public.current_employee_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can add products' using errcode = '42501';
  end if;

  if p_category_id is null or v_name is null or length(v_name) > 120
     or p_price_satang is null or p_price_satang <= 0
     or p_emoji is not null and length(p_emoji) > 16 then
    raise exception 'Product details are invalid';
  end if;

  perform 1 from public.categories
  where id = p_category_id and active
  for key share;
  if not found then
    raise exception 'Choose an active product category';
  end if;

  insert into public.products(
    category_id, name, emoji, price_satang, available, active, sort_order
  )
  values (
    p_category_id, v_name, nullif(trim(p_emoji), ''), p_price_satang,
    coalesce(p_available, true), true,
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

revoke all on function public.open_shift(integer, text) from public, anon, authenticated;
revoke all on function public.add_pos_product(uuid, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.open_shift(integer, text) to authenticated;
grant execute on function public.add_pos_product(uuid, text, text, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
