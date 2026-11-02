import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationPath = new URL("../supabase/migrations/0004_repair_employee_rpc_functions.sql", import.meta.url);
const shiftCatalogMigrationPath = new URL("../supabase/migrations/0005_idempotent_shifts_and_product_catalog.sql", import.meta.url);
const consistencyMigrationPath = new URL("../supabase/migrations/0006_pos_consistency_and_idempotency.sql", import.meta.url);
const authenticatedPosVerificationPath = new URL("../supabase/verify_authenticated_pos.sql", import.meta.url);
const categoryManagementMigrationPath = new URL("../supabase/migrations/0007_category_management.sql", import.meta.url);
const catalogManagementMigrationPath = new URL("../supabase/migrations/0008_catalog_management.sql", import.meta.url);
const financialIntegrityMigrationPath = new URL("../supabase/migrations/0009_pos_financial_integrity.sql", import.meta.url);
const taxPolicyMigrationPath = new URL("../supabase/migrations/0010_pos_tax_configuration_policy.sql", import.meta.url);
const taxDiagnosticPath = new URL("../supabase/diagnose_tax_configuration.sql", import.meta.url);
const posRoutePath = new URL("../app/api/pos/route.ts", import.meta.url);
const reportsRoutePath = new URL("../app/api/reports/route.ts", import.meta.url);

test("employee RPC repair migration restores the data-backed authenticated functions", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create or replace function public\.employee_directory\(\)/i);
  assert.match(migration, /returns table\(id uuid, name text\)/i);
  assert.match(migration, /where e\.active and public\.current_employee_id\(\) is not null/i);
  assert.match(migration, /create or replace function public\.current_employee_profile\(\)/i);
  assert.match(migration, /returns table\(id uuid, name text, role public\.employee_role, active boolean\)/i);
  assert.match(migration, /where e\.auth_user_id = \(select auth\.uid\(\)\) and e\.active/i);
  assert.match(migration, /grant execute on function public\.employee_directory\(\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.current_employee_profile\(\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.employee_directory\(\) from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.current_employee_profile\(\) from public, anon, authenticated/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(migration, /grant execute on function .* to anon/i);
});

test("shift opening is idempotent and catalog writes require manager-level authorization", async () => {
  const migration = await readFile(shiftCatalogMigrationPath, "utf8");
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /where register_id = v_register_id and status = 'open'/i);
  assert.match(migration, /'already_open', true/i);
  assert.match(migration, /create or replace function public\.add_pos_product\(/i);
  assert.match(migration, /public\.current_employee_role\(\) not in \('owner', 'manager'\)/i);
  assert.match(migration, /where id = p_category_id and active/i);
  assert.match(migration, /insert into public\.products/i);
  assert.match(migration, /revoke all on function public\.add_pos_product\(uuid, text, text, integer, boolean\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.add_pos_product\(uuid, text, text, integer, boolean\) to authenticated/i);
});

test("consistency migration serializes shift catalog, order, and checkout operations", async () => {
  const migration = await readFile(consistencyMigrationPath, "utf8");
  assert.match(migration, /where register_id = 'POS1' and status = 'open'/i);
  assert.match(migration, /burnbaru-pos-product:/i);
  assert.match(migration, /lower\(trim\(name\)\) = lower\(v_name\)/i);
  assert.match(migration, /burnbaru-pos-order:/i);
  assert.match(migration, /burnbaru-pos-checkout:/i);
  assert.match(migration, /v_existing\.received_satang is distinct from p_received_satang/i);
  assert.match(migration, /v_existing\.reference is distinct from v_reference/i);
  assert.match(migration, /from public\.categories[\s\S]*?for update/i);
  assert.match(migration, /set status = 'preparing', payment_method = p_method, paid_at = now\(\)/i);
  assert.match(migration, /insert into public\.payments/i);
  assert.match(migration, /insert into public\.receipts/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(migration, /grant execute on function .* to anon/i);
});

test("authenticated POS verification keeps the production read-path probes read-only", async () => {
  const verification = await readFile(authenticatedPosVerificationPath, "utf8");
  assert.match(verification, /^begin;/im);
  assert.match(verification, /set local role authenticated/i);
  assert.match(verification, /rpc\.current_employee_profile/i);
  assert.match(verification, /query\.categories/i);
  assert.match(verification, /query\.products/i);
  assert.match(verification, /query\.shifts/i);
  assert.match(verification, /query\.orders_queue_with_order_items/i);
  assert.match(verification, /query\.tax_configuration/i);
  assert.match(verification, /rpc\.pos_tax_configuration/i);
  assert.match(verification, /set local role authenticated/i);
  assert.match(verification, /rpc\.employee_directory/i);
  assert.match(verification, /metadata\.orders_to_order_items_fk/i);
  assert.match(verification, /rollback;\s*$/i);
  assert.doesNotMatch(verification, /\b(?:insert|update|delete)\s+into\s+public\./i);
});

test("category creation is manager-scoped, validated, and does not duplicate active categories", async () => {
  const migration = await readFile(categoryManagementMigrationPath, "utf8");
  assert.match(migration, /create or replace function public\.add_pos_category\(/i);
  assert.match(migration, /current_employee_role\(\) not in \('owner', 'manager'\)/i);
  assert.match(migration, /lower\(trim\(name\)\) = lower\(v_name\)/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /grant execute on function public\.add_pos_category\(text, text\) to authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function .*add_pos_category.* to anon/i);
});

test("catalog management preserves history and only grants owner/manager RPCs to authenticated users", async () => {
  const migration = await readFile(catalogManagementMigrationPath, "utf8");
  assert.match(migration, /create or replace function public\.update_pos_category\(/i);
  assert.match(migration, /create or replace function public\.update_pos_product\(/i);
  assert.match(migration, /current_employee_role\(\) not in \('owner', 'manager'\)/i);
  assert.match(migration, /insert into public\.audit_logs/i);
  assert.match(migration, /grant execute on function public\.update_pos_category\(uuid, text, text, boolean\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.update_pos_product\(uuid, uuid, text, text, integer, boolean, boolean\) to authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function .*update_pos_(?:category|product).* to anon/i);
  assert.doesNotMatch(migration, /\b(?:delete|truncate|drop)\s+(?:table|from)\b/i);
});

test("financial integrity migration requires tax configuration and records the actual refund channel", async () => {
  const migration = await readFile(financialIntegrityMigrationPath, "utf8");
  assert.match(migration, /alter table public\.refunds\s+add column if not exists sale_payment_method public\.payment_method/i);
  assert.match(migration, /create or replace function public\.create_order\(/i);
  assert.match(migration, /create or replace function public\.update_open_order\(/i);
  assert.equal((migration.match(/if not found then raise exception 'Tax configuration is missing'; end if;/gi) ?? []).length, 2);
  assert.match(migration, /create or replace function public\.refund_order\([\s\S]*?p_channel public\.pay_channel/i);
  assert.match(migration, /insert into public\.refunds\(\s*order_id, shift_id, employee_id, channel, sale_payment_method, amount_satang, reason\s*\)\s*values\s*\(\s*p_order_id, v_shift_id, v_employee_id, p_channel, v_sale_payment_method/i);
  assert.match(migration, /revoke all on function public\.refund_order\(uuid, integer, text\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.refund_order\(uuid, integer, public\.pay_channel, text\) to authenticated/i);
  assert.match(migration, /alter function public\.close_shift\(uuid, integer, text\)\s*set search_path = pg_catalog, public, pg_temp/i);
});

test("tax policy uses one employee-authorized read and disabled fallback across GET and order RPCs", async () => {
  const migration = await readFile(taxPolicyMigrationPath, "utf8");
  const route = await readFile(posRoutePath, "utf8");
  assert.match(migration, /create or replace function public\.pos_tax_configuration\(p_lock boolean default false\)/i);
  assert.match(migration, /security definer\s+set search_path = pg_catalog, public, pg_temp/i);
  assert.match(migration, /perform public\.assert_active_employee\(\)/i);
  assert.match(migration, /if p_lock then[\s\S]*?for share/i);
  assert.match(migration, /return query select false, 0, true/i);
  assert.match(migration, /revoke all on function public\.pos_tax_configuration\(boolean\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.pos_tax_configuration\(boolean\) to authenticated/i);
  assert.equal((migration.match(/from public\.pos_tax_configuration\(true\)/gi) ?? []).length, 2);
  assert.doesNotMatch(migration, /raise exception 'Tax configuration is missing'/i);
  assert.match(route, /supabase\.rpc\("pos_tax_configuration", \{ p_lock: false \}\)/i);
  assert.match(route, /if \(!user\)[\s\S]*?status: 401/i);
  assert.match(route, /if \(!isEmployee\(user, employee\)\)[\s\S]*?status: 403/i);
  assert.match(route, /taxConfiguration,\s*queue:/i);
  assert.match(route, /return withRequestId\(Response\.json\(\{[\s\S]*?taxConfiguration,[\s\S]*?\}\), requestId\)/i);
  assert.match(route, /input\.action === "saveOrder"[\s\S]*?supabase\.rpc\(rpcName, rpcArgs\)/i);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\s+into\s+public\.tax_configuration/i);
});

test("tax diagnostic SQL reads policies, grants, schema, rows, and RPCs without changing production data", async () => {
  const diagnostic = await readFile(taxDiagnosticPath, "utf8");
  assert.match(diagnostic, /information_schema\.columns/i);
  assert.match(diagnostic, /pg_constraint/i);
  assert.match(diagnostic, /from public\.tax_configuration/i);
  assert.match(diagnostic, /pg_policies/i);
  assert.match(diagnostic, /has_table_privilege/i);
  assert.match(diagnostic, /pos_tax_configuration/i);
  assert.match(diagnostic, /pg_get_functiondef/i);
  assert.doesNotMatch(diagnostic, /\b(?:insert|update|delete|truncate)\s+into\s+public\./i);
});

test("reports use paid transactions and return date-bounded cash history and shift reconciliations", async () => {
  const route = await readFile(reportsRoutePath, "utf8");
  assert.match(route, /\.in\("status", \["preparing", "completed"\]\)/);
  assert.match(route, /\.gte\("paid_at", start\)\.lte\("paid_at", end\)/);
  assert.match(route, /\.gte\("created_at", start\)\.lte\("created_at", end\)/);
  assert.match(route, /\.gte\("closed_at", start\)\.lte\("closed_at", end\)/);
  assert.match(route, /cash_movements: movements/);
  assert.match(route, /fetchAllPages/);
  assert.match(route, /shift_closings:/);
});
