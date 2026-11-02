import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateExpectedCash,
  calculateMovementTotals,
  calculateNetSales,
  calculateRefundTotalsByPaymentMethod,
  calculateShiftReconciliation,
} from "../lib/financial.ts";

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

test("income and expenses are reported separately by cash and bank channel", () => {
  assert.deepEqual(calculateMovementTotals([
    { type: "in", channel: "cash", amount_satang: 500 },
    { type: "out", channel: "cash", amount_satang: 125 },
    { type: "in", channel: "bank_transfer", amount_satang: 900 },
    { type: "out", channel: "bank_transfer", amount_satang: 250 },
  ]), { cashIncome: 500, cashExpenses: 125, bankIncome: 900, bankExpenses: 250 });
});

test("shift reconciliation keeps transfers and opening cash out of physical cash and revenue", () => {
  assert.deepEqual(calculateShiftReconciliation(10000, [
    { method: "cash", amount_satang: 7500 },
    { method: "bank_transfer", amount_satang: 4500 },
  ], [
    { channel: "cash", amount_satang: 1200 },
    { channel: "bank_transfer", amount_satang: 500 },
  ], [
    { type: "in", channel: "cash", amount_satang: 600 },
    { type: "out", channel: "cash", amount_satang: 300 },
    { type: "in", channel: "bank_transfer", amount_satang: 800 },
    { type: "out", channel: "bank_transfer", amount_satang: 100 },
  ]), {
    cashSales: 7500,
    transferSales: 4500,
    cashRefunds: 1200,
    totalRefunds: 1700,
    cashIncome: 600,
    cashExpenses: 300,
    bankIncome: 800,
    bankExpenses: 100,
    expectedCash: 16600,
    netSales: 10300,
  });
});

test("refund payout channel does not change the original sale payment-method report", () => {
  assert.deepEqual(calculateRefundTotalsByPaymentMethod([
    { channel: "bank_transfer", sale_payment_method: "cash", amount_satang: 500 },
    { channel: "cash", sale_payment_method: "bank_transfer", amount_satang: 750 },
    { channel: "cash", amount_satang: 200 },
  ]), { cash: 700, bankTransfer: 750 });
});
