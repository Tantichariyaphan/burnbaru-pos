# Grandfa Farm Cafe & Resort POS — Starter

Thai-first POS starter designed for iPad landscape. Includes a three-column demo UI, menu categories, cart quantity controls, checkout modal (cash/transfer), paid/preparation list, Done action, open/close shift demo, cash-in/out demo, and a simple summary. Includes an initial Supabase schema and seed file.

## Important limitation
**This ZIP is a starter/demo, not yet a production-ready POS.** The UI currently keeps orders, shifts, and cash movements in React state only. Data is lost when the page reloads, and the payment/shift dialogs do not write to Supabase yet. Do not use it as the only record of real sales until the Supabase authentication, RLS, server actions, transactional payment RPCs, and tests are implemented and verified.

## Menu pricing
Prices explicitly mapped from the supplied list:
- Original Cheesecake ฿59
- Matcha Cheesecake ฿79
- Red Velvet Cheesecake ฿69
The drink-price mapping in the supplied list is ambiguous. All drinks are disabled in the demo and seeded as unavailable until the owner confirms the price for each drink.

## Run locally
Requirements: Node.js 20+

```bash
npm install
npm run dev
```
Open http://localhost:3000.

## Deploy to Vercel
1. Push this folder to a private/public Git repository.
2. Import the repository in Vercel.
3. Deploy. The demo UI does not require environment variables.
4. Configure the Supabase URL and anon key in Vercel, then apply all pending production migrations as described below. Apply `supabase/seed.sql` only when the project needs the sample product catalog.

### Apply the production POS database migrations

The POS API requires every migration under `supabase/migrations/` to be applied to the same Supabase project configured in Vercel. Migration `0004_repair_employee_rpc_functions.sql` restores the employee RPCs. Migration `0005_idempotent_shifts_and_product_catalog.sql` makes opening a register shift idempotent and adds a manager-only product creation RPC. Vercel deployment does not apply Supabase migrations automatically.

The POS asks the employee to open a shift explicitly; background data refreshes no longer reopen the opening-cash dialog. Repeated open-shift requests for a register return its existing shift and do not create another opening cash record. Owners and managers can add products from the menu screen; the new products are stored in Supabase and are used by the existing order and reporting flows.

From the repository root, link the Supabase CLI to the production project and apply all pending migrations in order:

```powershell
supabase login
# Compare this exact ref with Supabase Dashboard > Project Settings > General
# and the hostname in Vercel's NEXT_PUBLIC_SUPABASE_URL before linking.
supabase link --project-ref <production-project-ref>
supabase migration list
supabase db push --dry-run
# Review the pending migration names before applying; do not use db reset.
supabase db push
supabase migration list
```

After applying migrations, deploy the application changes to Vercel. Use an authorized, non-production test employee account to sign in, then verify `GET /api/pos` and `GET /api/shifts` return real database-backed responses. Verify the same routes without a session return `401`. Do not test financial mutations against production customer/order data.

Run [`supabase/verify_pos_rpcs.sql`](./supabase/verify_pos_rpcs.sql) in the Supabase SQL Editor to inspect every application RPC's argument names/types, return type, security-definer setting, search path, and execute privileges, as well as RLS status for the application tables.

For the two employee RPCs, expected signatures are `public.current_employee_profile()` returning `(id uuid, name text, role employee_role, active boolean)` and `public.employee_directory()` returning `(id uuid, name text)`. Both should be security definer, executable by `authenticated`, and not executable by `anon`. The migration reloads PostgREST's schema cache; if it is still stale after the migration, run `notify pgrst, 'reload schema';` in the SQL Editor and retry the authenticated API requests.

If you need to inspect only those two functions, this query is also available:

```sql
select
  p.oid::regprocedure as signature,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('current_employee_profile', 'employee_directory')
order by p.proname;
```

## Recommended next steps for production
1. Apply and verify all production database migrations before enabling POS traffic.
2. Link each Supabase Auth user to an active employee row before granting POS access.
3. Verify authenticated `/api/pos` and `/api/shifts` responses against the production project after deployment.
4. Never expose the Supabase service-role key in browser code.
