export type ShiftCashInputs = {
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  countedCash?: number;
};

export function calculateExpectedCash(inputs: ShiftCashInputs) {
  const expectedCash = inputs.openingCash + inputs.cashSales - inputs.cashRefunds + inputs.cashIn - inputs.cashOut;
  return {
    expectedCash,
    variance: inputs.countedCash === undefined ? null : inputs.countedCash - expectedCash,
  };
}

export function calculateNetSales(paidAmounts: number[], refundAmounts: number[]) {
  return paidAmounts.reduce((total, amount) => total + amount, 0) -
    refundAmounts.reduce((total, amount) => total + amount, 0);
}

export type CashMovementRow = {
  type: "in" | "out" | "refund";
  channel: "cash" | "bank_transfer";
  amount_satang: number;
};

export type ShiftPaymentRow = {
  method: "cash" | "bank_transfer";
  amount_satang: number;
};

export type ShiftRefundRow = {
  channel: "cash" | "bank_transfer";
  amount_satang: number;
};

export type RefundMethodRow = ShiftRefundRow & {
  sale_payment_method?: "cash" | "bank_transfer" | null;
};

// Movements are operating cash flows, not sales.  Keep them separate from net
// sales so income cannot inflate revenue and expenses cannot look like refunds.
export function calculateMovementTotals(rows: CashMovementRow[]) {
  const total = (type: "in" | "out", channel: "cash" | "bank_transfer") => rows
    .filter((row) => row.type === type && row.channel === channel)
    .reduce((sum, row) => sum + row.amount_satang, 0);
  return {
    cashIncome: total("in", "cash"),
    cashExpenses: total("out", "cash"),
    bankIncome: total("in", "bank_transfer"),
    bankExpenses: total("out", "bank_transfer"),
  };
}

export function calculateShiftReconciliation(
  openingCash: number,
  payments: ShiftPaymentRow[],
  refunds: ShiftRefundRow[],
  movements: CashMovementRow[],
) {
  const cashSales = payments
    .filter((payment) => payment.method === "cash")
    .reduce((total, payment) => total + payment.amount_satang, 0);
  const transferSales = payments
    .filter((payment) => payment.method === "bank_transfer")
    .reduce((total, payment) => total + payment.amount_satang, 0);
  const cashRefunds = refunds
    .filter((refund) => refund.channel === "cash")
    .reduce((total, refund) => total + refund.amount_satang, 0);
  const totalRefunds = refunds.reduce((total, refund) => total + refund.amount_satang, 0);
  const movementTotals = calculateMovementTotals(movements);
  const { expectedCash } = calculateExpectedCash({
    openingCash,
    cashSales,
    cashRefunds,
    cashIn: movementTotals.cashIncome,
    cashOut: movementTotals.cashExpenses,
  });

  return {
    cashSales,
    transferSales,
    cashRefunds,
    totalRefunds,
    cashIncome: movementTotals.cashIncome,
    cashExpenses: movementTotals.cashExpenses,
    bankIncome: movementTotals.bankIncome,
    bankExpenses: movementTotals.bankExpenses,
    expectedCash,
    netSales: cashSales + transferSales - totalRefunds,
  };
}

export function calculateRefundTotalsByPaymentMethod(refunds: RefundMethodRow[]) {
  const total = (method: "cash" | "bank_transfer") => refunds
    .filter((refund) => (refund.sale_payment_method ?? refund.channel) === method)
    .reduce((sum, refund) => sum + refund.amount_satang, 0);
  return { cash: total("cash"), bankTransfer: total("bank_transfer") };
}
