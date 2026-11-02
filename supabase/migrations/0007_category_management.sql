create or replace function public.add_pos_category(
  p_name text,
  p_emoji text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_employee_id uuid := public.assert_active_employee();
  v_name text := nullif(trim(p_name), '');
  v_emoji text := nullif(trim(p_emoji), '');
  v_category public.categories%rowtype;
begin
  if public.current_employee_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can add categories' using errcode = '42501';
  end if;

  if v_name is null or length(v_name) > 120
     or v_emoji is not null and length(v_emoji) > 16 then
    raise exception 'Category details are invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('burnbaru-pos-category:' || lower(v_name), 0));

  select * into v_category
  from public.categories
  where lower(trim(name)) = lower(v_name)
  limit 1
  for update;
  if found then
    if v_category.active then
      return jsonb_build_object(
        'id', v_category.id, 'name', v_category.name, 'emoji', v_category.emoji,
        'sort_order', v_category.sort_order, 'already_exists', true
      );
    end if;
    raise exception 'A category with this name already exists but is inactive';
  end if;

  insert into public.categories(name, emoji, active, sort_order)
  values (
    v_name, v_emoji, true,
    coalesce((select max(sort_order) + 1 from public.categories), 0)
  )
  returning * into v_category;

  insert into public.audit_logs(employee_id, action, entity, entity_id, meta)
  values (v_employee_id, 'category.created', 'category', v_category.id,
    jsonb_build_object('name', v_category.name, 'emoji', v_category.emoji));

  return jsonb_build_object(
    'id', v_category.id, 'name', v_category.name, 'emoji', v_category.emoji,
    'sort_order', v_category.sort_order, 'already_exists', false
  );
end
$$;

revoke all on function public.add_pos_category(text, text) from public, anon, authenticated;
grant execute on function public.add_pos_category(text, text) to authenticated;

notify pgrst, 'reload schema';
