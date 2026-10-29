import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationPath = new URL("../supabase/migrations/0004_repair_employee_rpc_functions.sql", import.meta.url);
const shiftCatalogMigrationPath = new URL("../supabase/migrations/0005_idempotent_shifts_and_product_catalog.sql", import.meta.url);

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
