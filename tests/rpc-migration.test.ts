import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationPath = new URL("../supabase/migrations/0004_repair_employee_rpc_functions.sql", import.meta.url);
const shiftCatalogMigrationPath = new URL("../supabase/migrations/0005_idempotent_shifts_and_product_catalog.sql", import.meta.url);
const consistencyMigrationPath = new URL("../supabase/migrations/0006_pos_consistency_and_idempotency.sql", import.meta.url);
const authenticatedPosVerificationPath = new URL("../supabase/verify_authenticated_pos.sql", import.meta.url);

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
  assert.match(verification, /rpc\.employee_directory/i);
  assert.match(verification, /metadata\.orders_to_order_items_fk/i);
  assert.match(verification, /rollback;\s*$/i);
  assert.doesNotMatch(verification, /\b(?:insert|update|delete)\s+into\s+public\./i);
});
