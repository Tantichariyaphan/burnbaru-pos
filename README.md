# BurnBau POS

Thai-first point-of-sale application built with Next.js and Supabase. The application loads its catalog, employee, shift, order, payment, and reporting data from Supabase; it requires configured Supabase Auth, applied database migrations, and active employee profiles before it can process sales. Seed data is optional and should only be applied when initializing a project that needs the sample catalog.

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
3. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel for the intended Supabase project.
4. Apply all pending production migrations as described below. Apply `supabase/seed.sql` only when the project needs the sample product catalog.

### Apply the production POS database migrations

The POS API requires every migration under `supabase/migrations/` to be applied to the same Supabase project configured in Vercel. Migration `0004_repair_employee_rpc_functions.sql` restores the employee RPCs. Migration `0005_idempotent_shifts_and_product_catalog.sql` makes opening a register shift idempotent and adds product creation. Migration `0006_pos_consistency_and_idempotency.sql` prevents duplicate active product names within a category, serializes retried order/checkout requests, and scopes POS transactions to the same `POS1` register used by the UI. Migrations `0007_category_management.sql` and `0008_catalog_management.sql` add database-backed category and product management. Migration `0009_pos_financial_integrity.sql` records both refund payout and sale payment methods without backfilling existing rows and hardens RPC search paths. Migration `0010_pos_tax_configuration_policy.sql` exposes tax settings only to active employees through a narrowly scoped security-definer RPC and applies the same disabled-tax fallback to POS reads and order calculations. Vercel deployment does not apply Supabase migrations automatically.

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

When an authenticated `GET /api/pos` fails, run [`supabase/verify_authenticated_pos.sql`](./supabase/verify_authenticated_pos.sql) next. It temporarily simulates one active mapped employee inside a transaction, probes each read/RPC used by the endpoint, checks the required columns and `orders` → `order_items` foreign key, then rolls back. It does not modify POS business data or the open shift. This validates database/RLS behavior only; it does not prove the browser cookie, token refresh, PostgREST HTTP handling, or deployed Vercel environment. Reproduce the request from the real POS and correlate its `x-request-id` response header with Vercel Runtime Logs.

For tax-specific production investigation, run [`supabase/diagnose_tax_configuration.sql`](./supabase/diagnose_tax_configuration.sql) to inspect the table schema, existing tax row, RLS policy definitions, grants, and tax/order RPC definitions. SQL Editor commonly runs as a privileged owner and bypasses RLS; its result alone does not establish what an authenticated employee sees. The POS logs include a request correlation ID, a sanitized Supabase project hostname, the tax-read outcome, and sanitized Supabase error diagnostics. To test direct table visibility under the actual POS request JWT, temporarily set `POS_TAX_RLS_DIAGNOSTICS=true` in Vercel, redeploy, and make one authenticated POS request; unset it after collecting the matching `x-request-id` log. A missing tax row uses the explicit disabled, zero-rate default; a query/RPC error is not converted into that fallback.

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
