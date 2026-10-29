import assert from "node:assert/strict";
import test from "node:test";
import { calculateExpectedCash, calculateNetSales } from "../lib/financial.ts";

test("cash reconciliation excludes transfer payments and subtracts cash refunds", () => {
  const result = calculateExpectedCash({
    openingCash: 10000,
    cashSales: 7500,
    cashRefunds: 1200,
    cashIn: 500,
    cashOut: 300,
  });
  assert.deepEqual(result, { expectedCash: 16500, variance: null });
});

test("cash reconciliation reports counted-cash variance", () => {
  const result = calculateExpectedCash({
    openingCash: 5000,
    cashSales: 12000,
    cashRefunds: 0,
    cashIn: 0,
    cashOut: 2000,
    countedCash: 14700,
  });
  assert.deepEqual(result, { expectedCash: 15000, variance: -300 });
});

test("net sales subtract refunds from paid transactions only", () => {
  assert.equal(calculateNetSales([10000, 2500], [3000]), 9500);
});
