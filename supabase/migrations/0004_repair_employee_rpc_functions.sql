create or replace function public.employee_directory()
returns table(id uuid, name text)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select e.id, e.name
  from public.employees as e
  where e.active and public.current_employee_id() is not null
  order by e.name
$$;

create or replace function public.current_employee_profile()
returns table(id uuid, name text, role public.employee_role, active boolean)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select e.id, e.name, e.role, e.active
  from public.employees as e
  where e.auth_user_id = (select auth.uid()) and e.active
  limit 1
$$;

revoke all on function public.employee_directory() from public, anon, authenticated;
revoke all on function public.current_employee_profile() from public, anon, authenticated;
grant execute on function public.employee_directory() to authenticated;
grant execute on function public.current_employee_profile() to authenticated;

notify pgrst, 'reload schema';
