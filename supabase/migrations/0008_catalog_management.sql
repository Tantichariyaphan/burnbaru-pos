-- Management RPCs only.  This migration preserves existing products, categories,
-- orders, and historical price snapshots; it is intentionally not a seed script.
create or replace function public.update_pos_category(
  p_category_id uuid, p_name text, p_emoji text, p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_employee_id uuid := public.assert_active_employee();
  v_category public.categories%rowtype;
  v_name text := nullif(trim(p_name), '');
  v_emoji text := nullif(trim(p_emoji), '');
begin
  if public.current_employee_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can manage categories' using errcode = '42501';
  end if;
  if p_category_id is null or v_name is null or length(v_name) > 120
     or v_emoji is not null and length(v_emoji) > 16 or p_active is null then
    raise exception 'Category details are invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('burnbaru-pos-category:' || lower(v_name), 0));
  select * into v_category from public.categories where id = p_category_id for update;
  if not found then raise exception 'Category was not found'; end if;
  if p_active and exists (
    select 1 from public.categories
    where id <> p_category_id and active and lower(trim(name)) = lower(v_name)
  ) then
    raise exception 'An active category with this name already exists';
  end if;

  update public.categories set name = v_name, emoji = v_emoji, active = p_active
  where id = p_category_id returning * into v_category;
  insert into public.audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'category.updated', 'category', v_category.id,
    jsonb_build_object('name', v_category.name, 'active', v_category.active));
  return jsonb_build_object('id', v_category.id, 'name', v_category.name,
    'emoji', v_category.emoji, 'sort_order', v_category.sort_order, 'active', v_category.active);
end
$$;

create or replace function public.update_pos_product(
  p_product_id uuid, p_category_id uuid, p_name text, p_emoji text,
  p_price_satang integer, p_available boolean, p_active boolean
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
    raise exception 'Only an owner or manager can manage products' using errcode = '42501';
  end if;
  if p_product_id is null or p_category_id is null or v_name is null or length(v_name) > 120
     or p_price_satang is null or p_price_satang <= 0 or v_emoji is not null and length(v_emoji) > 16
     or p_available is null or p_active is null then
    raise exception 'Product details are invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'burnbaru-pos-product:' || p_category_id::text || ':' || lower(v_name), 0
  ));
  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product was not found'; end if;
  perform 1 from public.categories where id = p_category_id for update;
  if not found then raise exception 'Choose a product category'; end if;
  if p_active and not exists (select 1 from public.categories where id = p_category_id and active) then
    raise exception 'Choose an active product category';
  end if;
  if p_active and exists (
    select 1 from public.products
    where id <> p_product_id and category_id = p_category_id and active
      and lower(trim(name)) = lower(v_name)
  ) then
    raise exception 'An active product with this name already exists in the category';
  end if;

  update public.products
  set category_id = p_category_id, name = v_name, emoji = v_emoji, price_satang = p_price_satang,
      available = p_available, active = p_active, updated_at = now()
  where id = p_product_id returning * into v_product;
  insert into public.audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'product.updated', 'product', v_product.id,
    jsonb_build_object('category_id', v_product.category_id, 'name', v_product.name,
      'price_satang', v_product.price_satang, 'available', v_product.available, 'active', v_product.active));
  return jsonb_build_object('id', v_product.id, 'category_id', v_product.category_id,
    'name', v_product.name, 'emoji', v_product.emoji, 'price_satang', v_product.price_satang,
    'available', v_product.available, 'active', v_product.active, 'sort_order', v_product.sort_order);
end
$$;

revoke all on function public.update_pos_category(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.update_pos_product(uuid, uuid, text, text, integer, boolean, boolean) from public, anon, authenticated;
grant execute on function public.update_pos_category(uuid, text, text, boolean) to authenticated;
grant execute on function public.update_pos_product(uuid, uuid, text, text, integer, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
