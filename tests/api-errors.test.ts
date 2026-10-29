import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import { apiFailure } from "../lib/api-errors.ts";

test("missing Supabase session is returned as 401", async () => {
  const response = apiFailure(new AuthSessionMissingError(), "test");
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
    const response = apiFailure(new Error("sensitive backend details"), "test");
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "เกิดข้อผิดพลาดภายในระบบ กรุณาลองอีกครั้ง" });
    assert.deepEqual(logArgs, ["[test] Unexpected request failure", { name: "Error", code: undefined }]);
  } finally {
    console.error = originalError;
  }
});
