-- Read-only tax configuration diagnostics for Supabase SQL Editor.
-- SQL Editor normally runs with an owner role and bypasses RLS; use
-- verify_authenticated_pos.sql to simulate an authenticated employee read.

select
  current_database() as database_name,
  current_user as database_role,
  current_setting('request.jwt.claim.role', true) as jwt_role;

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'tax_configuration'
order by ordinal_position;

select
  c.conname as constraint_name,
  c.contype as constraint_type,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint as c
where c.conrelid = to_regclass('public.tax_configuration')
order by c.conname;

select singleton, enabled, rate_bps, updated_at
from public.tax_configuration
order by singleton;

select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  pg_get_userbyid(c.relowner) as table_owner,
  row_security_active(c.oid) as rls_active_for_current_role
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'tax_configuration';

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'tax_configuration'
order by policyname;

select
  role_name,
  has_table_privilege(role_name, 'public.tax_configuration', 'SELECT') as can_select,
  has_table_privilege(role_name, 'public.tax_configuration', 'INSERT') as can_insert,
  has_table_privilege(role_name, 'public.tax_configuration', 'UPDATE') as can_update,
  has_table_privilege(role_name, 'public.tax_configuration', 'DELETE') as can_delete
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);

select
  p.oid::regprocedure as function_signature,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig as function_settings,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute,
  pg_get_functiondef(p.oid) as definition
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'pos_tax_configuration',
    'create_order',
    'update_open_order',
    'current_employee_profile',
    'assert_active_employee'
  )
order by p.proname, p.oid::regprocedure::text;
