import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { apiFailure, logQueryFailure, logRpcFailure } from "../lib/api-errors.ts";

test("missing Supabase session is returned as 401", async () => {
  const response = apiFailure(new AuthSessionMissingError(), "test");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "กรุณาเข้าสู่ระบบ" });
});

test("invalid Supabase credentials are returned as 401", async () => {
  const response = apiFailure(new AuthApiError("Invalid JWT", 401, "invalid_token"), "test");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "กรุณาเข้าสู่ระบบ" });
});

test("database authorization failures are returned as 403", async () => {
  const response = apiFailure({ code: "42501", message: "permission denied" }, "test");
  assert.equal(response.status, 403);
});

test("unexpected failures are logged and returned as safe 500 responses", async () => {
  const originalError = console.error;
  let logArgs: unknown[] = [];
  console.error = (...args: unknown[]) => { logArgs = args; };
  try {
    const response = apiFailure(new Error("settings missing for user@example.com Bearer eyJhbGci.eyJzdWI.abc"), "test");
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "เกิดข้อผิดพลาดภายในระบบ กรุณาลองอีกครั้ง" });
    assert.equal(logArgs[0], "[test] Unexpected request failure");
    const diagnostic = logArgs[1] as { name?: string; code?: string; message?: string };
    assert.equal(diagnostic.name, "Error");
    assert.equal(diagnostic.code, undefined);
    assert.match(diagnostic.message ?? "", /^settings missing for \[REDACTED EMAIL\]/);
    assert.doesNotMatch(JSON.stringify(logArgs), /user@example\.com|eyJhbGci/);
  } finally {
    console.error = originalError;
  }
});

test("RPC diagnostics identify the route and RPC without logging credentials", () => {
  const originalError = console.error;
  let logArgs: unknown[] = [];
  console.error = (...args: unknown[]) => { logArgs = args; };
  try {
    logRpcFailure("api/pos GET", "current_employee_profile", {
      code: "PGRST202",
      message: "Bearer example-token user@example.com",
      details: "JWT eyJhbGci.eyJzdWI.abc sb_secret_example",
      hint: "refresh schema",
    });
    assert.equal(logArgs[0], "[api/pos GET] Supabase RPC current_employee_profile failed");
    const diagnostics = logArgs[1] as Record<string, string>;
    assert.equal(diagnostics.code, "PGRST202");
    assert.match(diagnostics.message, /Bearer \[REDACTED\] \[REDACTED EMAIL\]/);
    assert.doesNotMatch(JSON.stringify(diagnostics), /example-token|user@example.com|sb_secret_example|eyJhbGci/);
  } finally {
    console.error = originalError;
  }
});

test("query diagnostics identify the failing query and redact sensitive values", () => {
  const originalError = console.error;
  let logArgs: unknown[] = [];
  console.error = (...args: unknown[]) => { logArgs = args; };
  try {
    logQueryFailure("api/pos GET", "tax_configuration", {
      code: "42501",
      message: "permission denied for user@example.com",
      details: "Bearer eyJhbGci.eyJzdWI.abc",
      hint: "check grants",
    });
    assert.equal(logArgs[0], "[api/pos GET] Supabase query tax_configuration failed");
    const diagnostics = logArgs[1] as Record<string, string>;
    assert.equal(diagnostics.code, "42501");
    assert.match(diagnostics.message, /\[REDACTED EMAIL\]/);
    assert.doesNotMatch(JSON.stringify(diagnostics), /user@example\.com|eyJhbGci/);
  } finally {
    console.error = originalError;
  }
});
