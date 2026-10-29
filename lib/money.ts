export type Satang = number;
export function bahtToSatang(value: number | string): Satang {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n) || n < 0) throw new Error('จำนวนเงินไม่ถูกต้อง');
  return Math.round(n * 100);
}
export function formatTHB(satang: Satang): string {
  const amount = satang / 100;
  return '฿' + amount.toLocaleString('th-TH', { minimumFractionDigits: satang % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
