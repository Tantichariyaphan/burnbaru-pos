import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTaxConfiguration } from "../lib/tax-configuration.ts";

test("an enabled tax configuration is returned unchanged", () => {
  assert.deepEqual(resolveTaxConfiguration({ enabled: true, rate_bps: 700 }), {
    enabled: true,
    rate_bps: 700,
  });
});

test("a disabled zero-rate tax configuration is returned unchanged", () => {
  assert.deepEqual(resolveTaxConfiguration({ enabled: false, rate_bps: 0 }), {
    enabled: false,
    rate_bps: 0,
  });
});

test("a successful tax query with no visible row follows the existing disabled-tax contract", () => {
  assert.deepEqual(resolveTaxConfiguration(null), { enabled: false, rate_bps: 0 });
});
