with expected(signature) as (
  values
    ('public.current_employee_profile()'),
    ('public.employee_directory()'),
    ('public.open_shift(integer, text)'),
    ('public.create_order(jsonb, integer, uuid)'),
    ('public.update_open_order(uuid, jsonb, integer)'),
    ('public.checkout_order(uuid, public.payment_method, integer, text, uuid)'),
    ('public.record_cash_movement(public.cash_move_type, public.pay_channel, integer, text, text)'),
    ('public.mark_order_done(uuid)'),
    ('public.cancel_open_order(uuid, text)'),
    ('public.refund_order(uuid, integer, text)'),
    ('public.close_shift(uuid, integer, text)')
)
select
  e.signature as expected_signature,
  p.oid::regprocedure as actual_signature,
  coalesce(p.oid is not null, false) as function_exists,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type,
  pg_get_userbyid(p.proowner) as function_owner,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_can_execute,
  coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_can_execute
from expected as e
left join pg_proc as p on p.oid = to_regprocedure(e.signature)
order by e.signature;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  count(p.policyname) as policy_count,
  coalesce(bool_or('anon' = any(p.roles) or 'public' = any(p.roles)), false) as has_anon_policy
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
left join pg_policies as p
  on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'employees', 'categories', 'products', 'shifts', 'orders', 'order_items',
    'payments', 'cash_movements', 'refunds', 'audit_logs', 'product_modifiers',
    'product_modifier_assignments', 'discounts', 'tax_configuration', 'inventory',
    'inventory_movements', 'customers', 'store_settings', 'receipts', 'shift_closings'
  )
group by c.relname, c.relrowsecurity, c.relforcerowsecurity
order by c.relname;
