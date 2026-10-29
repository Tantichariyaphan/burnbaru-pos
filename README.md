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
4. For real data persistence, create a Supabase project and apply `supabase/migrations/0001_schema.sql`, then `supabase/seed.sql` in the SQL editor. Do not treat this alone as production-ready: implement and test RLS policies and secure server-side transactional actions before entering real customer transactions.

## Recommended next steps for production
1. Add Supabase Auth and employee-role checks.
2. Add restrictive RLS policies; never expose the service-role key to browser code.
3. Implement server-side order persistence and atomic/idempotent payment confirmation.
4. Implement cash movement and shift close calculations on the server.
5. Add refunds/voids, receipts, product/employee administration, reports, inventory, and automated tests.
