import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveTaxConfigurationRpcResult,
  taxConfigurationErrorCategory,
} from "../lib/tax-configuration.ts";

test("the existing disabled, zero-rate tax row is retrieved unchanged", () => {
  assert.deepEqual(resolveTaxConfigurationRpcResult([
    { enabled: false, rate_bps: 0, fallback_applied: false },
  ], null), {
    configuration: { enabled: false, rate_bps: 0 },
    fallbackApplied: false,
  });
});

test("an enabled tax row is retrieved unchanged", () => {
  assert.deepEqual(resolveTaxConfigurationRpcResult([
    { enabled: true, rate_bps: 700, fallback_applied: false },
  ], null), {
    configuration: { enabled: true, rate_bps: 700 },
    fallbackApplied: false,
  });
});

test("a successful missing-row result uses the explicit disabled, zero-rate fallback", () => {
  assert.deepEqual(resolveTaxConfigurationRpcResult([
    { enabled: false, rate_bps: 0, fallback_applied: true },
  ], null), {
    configuration: { enabled: false, rate_bps: 0 },
    fallbackApplied: true,
  });
});

test("permission and RLS errors remain errors instead of becoming the fallback", () => {
  const error = { code: "42501", message: "permission denied" };
  assert.equal(taxConfigurationErrorCategory(error), "permission_or_authentication_error");
  assert.throws(() => resolveTaxConfigurationRpcResult(null, error), (caught) => caught === error);
});

test("connection errors remain errors instead of becoming zero tax", () => {
  const error = new TypeError("fetch failed");
  assert.equal(taxConfigurationErrorCategory(error), "connection_or_environment_error");
  assert.throws(() => resolveTaxConfigurationRpcResult(null, error), (caught) => caught === error);
});

test("schema errors are distinguishable from a successful empty configuration", () => {
  assert.equal(
    taxConfigurationErrorCategory({ code: "PGRST202", message: "function not found" }),
    "schema_or_table_error",
  );
  assert.throws(() => resolveTaxConfigurationRpcResult([], null), /invalid result/);
});

test("malformed tax RPC results are not silently treated as missing configuration", () => {
  assert.throws(
    () => resolveTaxConfigurationRpcResult([
      { enabled: true, rate_bps: 700, fallback_applied: true },
    ], null),
    /invalid fallback/,
  );
});
