import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCartTotals, filterPosProducts, sameActiveShift } from "../lib/pos-catalog.ts";
import type { PosProduct } from "../lib/pos-types.ts";

const products: PosProduct[] = [
  { id: "cake-1", name: "Original Cheesecake", emoji: null, price_satang: 5900, available: true, category_id: "cakes", sort_order: 1 },
  { id: "tea-1", name: "Matcha Latte", emoji: null, price_satang: 0, available: false, category_id: "drinks", sort_order: 1 },
  { id: "cake-2", name: "Matcha Cheesecake", emoji: null, price_satang: 7900, available: true, category_id: "cakes", sort_order: 2 },
];

test("catalog filtering keeps category and search selection consistent", () => {
  assert.deepEqual(filterPosProducts(products, "cakes", "matcha").map((product) => product.id), ["cake-2"]);
  assert.deepEqual(filterPosProducts(products, "all", "  LATTE ").map((product) => product.id), ["tea-1"]);
  assert.deepEqual(filterPosProducts(products, "unknown", ""), []);
});

test("cart totals use integer satang and database tax configuration", () => {
  assert.deepEqual(calculateCartTotals(101, { enabled: true, rate_bps: 750 }), {
    subtotalSatang: 101,
    taxSatang: 8,
    totalSatang: 109,
  });
  assert.deepEqual(calculateCartTotals(101, { enabled: false, rate_bps: 750 }), {
    subtotalSatang: 101,
    taxSatang: 0,
    totalSatang: 101,
  });
});

test("POS and shift summaries must refer to the same database shift", () => {
  assert.equal(sameActiveShift({ id: "shift-1" }, { id: "shift-1" }), true);
  assert.equal(sameActiveShift(null, null), true);
  assert.equal(sameActiveShift({ id: "shift-1" }, null), false);
  assert.equal(sameActiveShift({ id: "shift-1" }, { id: "shift-2" }), false);
});
