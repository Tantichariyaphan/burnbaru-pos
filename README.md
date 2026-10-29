# BurnBau POS

BurnBau POS is a Next.js point-of-sale application backed by Supabase PostgreSQL. Saved orders, payments, receipts, shift transactions, and shift closings are database records; the browser is not their source of truth.

## What is implemented

- Supabase email/password sign-in and active employee profile checks.
- Database-backed product/category loading and a three-column POS.
- Saved unpaid orders, server-priced order lines, cash and bank-transfer checkout, payment idempotency, persistent receipts, and a paid-order preparation queue.
- Order history search and filters, order details, unpaid-order editing/cancellation, receipt reprinting, and manager/owner refunds.
- Persistent shift opening, cash/bank-transfer movements, cash reconciliation, immutable closing snapshots, and shift history.
- Sales totals and product/category/employee/payment-channel reports from saved database records.
- RLS read policies, server-checked role permissions, transactional database functions, and audit records for financial operations.

## Supabase setup

1. Create a Supabase project. In **Authentication → Providers**, enable email/password sign-in. Create each employee's Auth user from the Supabase dashboard; public self-registration is not used.
2. Link this repository to the project and apply migrations in order:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   The migration set is `supabase/migrations/0001_schema.sql` followed by `supabase/migrations/0002_pos_security_and_transactions.sql`. Alternatively, run both files in order in the Supabase SQL Editor. Do not expose a database password or service-role key in the browser.
3. Link the first Auth user to an owner profile. Replace the email/name with the account created above and run this in the SQL Editor:

   ```sql
   insert into public.employees (auth_user_id, name, email, role, active)
   select id, 'Store Owner', email, 'owner', true
   from auth.users
   where email = 'owner@example.com'
   on conflict (email) do update
     set auth_user_id = excluded.auth_user_id,
         role = 'owner',
         active = true;
   ```

   Create other employee rows the same way, using `cashier` or `manager` as the role. The profile's `auth_user_id` must match that employee's Supabase Auth user.
4. Optional: run `supabase/seed.sql` once in the SQL Editor to add the starter categories and products. Only products with confirmed prices are enabled by the seed. Set product prices/availability in the database until the management interface is implemented.
5. Copy `.env.example` to `.env.local` and set:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
   ```

   The app uses the public anon key with RLS and does **not** need a service-role key. Never put a service-role key in a `NEXT_PUBLIC_*` variable.
6. Install and run:

   ```powershell
   npm ci
   npm run dev
   ```

   Sign in with an Auth user that has an active employee profile. Open a shift before adding products.

## Financial rules

- Only orders with a committed payment count as sales. Unpaid and cancelled orders are excluded.
- Report gross sales are successful payment amounts. Net sales are paid amounts less refunds processed in the selected date range; totals include tax, which is also reported separately. Discounts are reported separately and already reduce order totals.
- Expected physical cash is opening cash + cash payments − cash refunds + cash-in − cash-out. Bank-transfer sales and movements do not change the physical cash balance.
- Shift close records a database snapshot and variance; the closed shift is not overwritten by this application.
- A checkout is one full payment per order. The database transaction commits the payment, paid/preparation status, receipt, and audit entry together. Repeated checkout requests cannot create another payment for the same order.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` covers cash reconciliation and net-sales arithmetic. Applying migrations and verifying live order persistence, RLS behavior, checkout concurrency, and shift reconciliation require a configured Supabase project and employee account; those checks have not been claimed as successful without project access.

## Vercel deployment

1. Keep the existing GitHub repository connected to the existing Vercel project. Do not change the repository or package name (`burnbaru-pos`).
2. Apply the Supabase migrations and create/link employee Auth profiles before deploying.
3. In **Vercel → Project → Settings → Environment Variables**, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the required environments (Production, Preview, and Development as appropriate).
4. Use the repository root as the project root, `npm run build` as the build command, and `npm run start` as the start command. The project uses the existing Next.js configuration; do not add a service-role key.
5. Redeploy after setting environment variables. Sign in, open a shift, create an order, refresh and check order history, complete checkout, verify the receipt/queue, and close a test shift before using the deployment for live trading.

## Not yet implemented

This is a persistent core workflow, not a finished all-purpose store-management suite. Product/category/modifier CRUD, configurable discount and tax screens, stock deduction and inventory adjustment workflows, employee/permission administration, customer management, editable store settings, and cash-movement/receipt-specific report screens remain incomplete. Their data tables are present where applicable, but there are no management pages or end-to-end workflows for them yet. The initial schema/migration and application also have not been applied to or tested against a live Supabase project from this environment.
