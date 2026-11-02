-- Read-only production diagnostic for the authenticated GET /api/pos path.
-- Run this as a database administrator in the Supabase SQL editor. It selects
-- one active owner (falling back to another active mapped employee), evaluates
-- database/RLS behavior similar to that user, and rolls everything back. It
-- never changes business data, shifts, orders, payments, or configuration.
-- This does not prove browser cookies, token refresh, PostgREST HTTP handling,
-- or the deployed Vercel environment.

begin;

create temporary table pos_probe_target on commit drop as
select e.auth_user_id
from public.employees as e
where e.active
  and e.auth_user_id is not null
order by (e.role = 'owner') desc, e.created_at
limit 1;

create temporary table pos_probe_results (
  operation text primary key,
  status text not null,
  sqlstate text,
  diagnostic text
) on commit drop;

grant select, insert, update on table pos_probe_results to authenticated;

insert into pos_probe_results(operation, status, diagnostic)
select
  'authentication_target',
  case when exists (select 1 from pos_probe_target) then 'ok' else 'failed' end,
  case when exists (select 1 from pos_probe_target)
    then 'active employee mapping found'
    else 'no active employee has an auth_user_id mapping'
  end;

-- Supabase's auth.uid() reads these request-scoped JWT claim settings.  Set
-- both forms for compatibility with current and older Supabase deployments.
select set_config('request.jwt.claim.sub', auth_user_id::text, true)
from pos_probe_target;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', auth_user_id, 'role', 'authenticated')::text,
  true
)
from pos_probe_target;

set local role authenticated;

do $$
declare
  v_count bigint;
begin
  begin
    select count(*) into v_count from public.current_employee_profile();
    insert into pg_temp.pos_probe_results values (
      'rpc.current_employee_profile',
      case when v_count = 1 then 'ok' else 'failed' end,
      null,
      case when v_count = 1 then 'one active employee profile returned'
           else format('expected one profile, received %s', v_count) end
    );
  exception when others then
    insert into pg_temp.pos_probe_results values ('rpc.current_employee_profile', 'failed', sqlstate, sqlerrm);
  end;

  begin
    perform 1 from public.categories
      where active = true order by sort_order limit 1;
    insert into pg_temp.pos_probe_results values ('query.categories', 'ok', null, 'select id, name, emoji, sort_order');
  exception when others then
    insert into pg_temp.pos_probe_results values ('query.categories', 'failed', sqlstate, sqlerrm);
  end;

  begin
    perform 1 from public.products
      where active = true order by sort_order limit 1;
    insert into pg_temp.pos_probe_results values ('query.products', 'ok', null, 'select id, name, emoji, category_id, price_satang, available, sort_order');
  exception when others then
    insert into pg_temp.pos_probe_results values ('query.products', 'failed', sqlstate, sqlerrm);
  end;

  begin
    select count(*) into v_count from public.shifts
      where register_id = 'POS1' and status = 'open';
    insert into pg_temp.pos_probe_results values (
      'query.shifts',
      case when v_count <= 1 then 'ok' else 'failed' end,
      null,
      case when v_count <= 1 then format('%s open POS1 shift(s)', v_count)
           else format('maybeSingle() would fail: %s open POS1 shifts', v_count) end
    );
  exception when others then
    insert into pg_temp.pos_probe_results values ('query.shifts', 'failed', sqlstate, sqlerrm);
  end;

  begin
    perform 1
    from public.orders as o
    left join public.order_items as oi on oi.order_id = o.id
    where o.status = 'preparing'
    order by o.paid_at asc nulls first
    limit 60;
    insert into pg_temp.pos_probe_results values ('query.orders_queue_with_order_items', 'ok', null, 'orders/order_items read and relationship join');
  exception when others then
    insert into pg_temp.pos_probe_results values ('query.orders_queue_with_order_items', 'failed', sqlstate, sqlerrm);
  end;

  begin
    select count(*) into v_count from public.tax_configuration where singleton = true;
    insert into pg_temp.pos_probe_results values (
      'query.tax_configuration',
      case when v_count = 1 then 'ok' else 'failed' end,
      null,
      case when v_count = 1 then 'one singleton tax configuration returned'
           else format('expected one singleton tax configuration, received %s', v_count) end
    );
  exception when others then
    insert into pg_temp.pos_probe_results values ('query.tax_configuration', 'failed', sqlstate, sqlerrm);
  end;

  begin
    perform 1 from public.employee_directory() limit 1;
    insert into pg_temp.pos_probe_results values ('rpc.employee_directory', 'ok', null, 'authenticated directory execution');
  exception when others then
    insert into pg_temp.pos_probe_results values ('rpc.employee_directory', 'failed', sqlstate, sqlerrm);
  end;
end
$$;

reset role;

-- These metadata checks cover the selected columns, the PostgREST relationship,
-- function contracts, security-definer configuration, function grants, RLS and
-- table SELECT grants used by GET /api/pos.
with expected_columns(table_name, column_name) as (
  values
    ('categories', 'id'), ('categories', 'name'), ('categories', 'emoji'), ('categories', 'sort_order'), ('categories', 'active'),
    ('products', 'id'), ('products', 'name'), ('products', 'emoji'), ('products', 'category_id'), ('products', 'price_satang'), ('products', 'available'), ('products', 'sort_order'), ('products', 'active'),
    ('shifts', 'id'), ('shifts', 'register_id'), ('shifts', 'opening_cash_satang'), ('shifts', 'opened_at'), ('shifts', 'opened_by'), ('shifts', 'status'),
    ('orders', 'id'), ('orders', 'order_no'), ('orders', 'total_satang'), ('orders', 'status'), ('orders', 'paid_at'), ('orders', 'created_at'), ('orders', 'payment_method'),
    ('order_items', 'id'), ('order_items', 'order_id'), ('order_items', 'name_snapshot'), ('order_items', 'emoji_snapshot'), ('order_items', 'unit_price_satang'), ('order_items', 'quantity'), ('order_items', 'line_total_satang'),
    ('tax_configuration', 'singleton'), ('tax_configuration', 'enabled'), ('tax_configuration', 'rate_bps')
)
select
  'metadata.selected_columns' as operation,
  case when count(*) filter (where c.column_name is null) = 0 then 'ok' else 'failed' end as status,
  string_agg(format('%s.%s', e.table_name, e.column_name), ', ' order by e.table_name, e.column_name)
    filter (where c.column_name is null) as missing_columns
from expected_columns as e
left join information_schema.columns as c
  on c.table_schema = 'public' and c.table_name = e.table_name and c.column_name = e.column_name;

select
  'metadata.orders_to_order_items_fk' as operation,
  case when exists (
    select 1
    from pg_constraint as fk
    where fk.contype = 'f'
      and fk.conrelid = 'public.order_items'::regclass
      and fk.confrelid = 'public.orders'::regclass
  ) then 'ok' else 'failed' end as status;

with expected_rpc(signature) as (
  values ('public.current_employee_profile()'), ('public.employee_directory()')
)
select
  e.signature,
  case when p.oid is not null
            and p.prosecdef
            and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=pg_catalog, public, pg_temp%'
            and has_function_privilege('authenticated', p.oid, 'EXECUTE')
            and not has_function_privilege('anon', p.oid, 'EXECUTE')
       then 'ok' else 'failed' end as status,
  p.oid::regprocedure as actual_signature,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_can_execute,
  coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_can_execute
from expected_rpc as e
left join pg_proc as p on p.oid = to_regprocedure(e.signature)
order by e.signature;

with pos_tables(table_name) as (
  values ('categories'), ('products'), ('shifts'), ('orders'), ('order_items'), ('tax_configuration')
)
select
  t.table_name,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('authenticated', format('public.%I', t.table_name), 'SELECT') as authenticated_can_select,
  count(p.policyname) filter (where 'authenticated' = any(p.roles) or 'public' = any(p.roles)) as authenticated_select_policy_count
from pos_tables as t
join pg_class as c on c.oid = format('public.%I', t.table_name)::regclass
left join pg_policies as p
  on p.schemaname = 'public' and p.tablename = t.table_name and p.cmd in ('SELECT', 'ALL')
group by t.table_name, c.relrowsecurity
order by t.table_name;

select operation, status, sqlstate, diagnostic
from pos_probe_results
order by operation;

rollback;
