import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchAllPages } from "../lib/supabase-pagination.ts";

test("Supabase query pages are fetched past the configured 1000-row limit", async () => {
  const rows = Array.from({ length: 2050 }, (_, index) => index);
  const ranges: Array<[number, number]> = [];
  const result = await fetchAllPages(async (from, to) => {
    ranges.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  });

  assert.equal(result.length, rows.length);
  assert.deepEqual(result, rows);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("Supabase page errors are surfaced instead of returning partial totals", async () => {
  const failure = new Error("query failed");
  await assert.rejects(
    fetchAllPages(async () => ({ data: null, error: failure })),
    failure,
  );
});
