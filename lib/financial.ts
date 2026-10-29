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
