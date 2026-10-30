import type { PosProduct } from "@/lib/pos-types";

export function filterPosProducts(
  products: PosProduct[],
  categoryId: string,
  search: string,
) {
  const query = search.trim().toLocaleLowerCase();
  return products.filter((product) => {
    const matchesCategory = categoryId === "all" || product.category_id === categoryId;
    return matchesCategory && product.name.toLocaleLowerCase().includes(query);
  });
}

export function calculateCartTotals(
  subtotalSatang: number,
  taxConfiguration: { enabled: boolean; rate_bps: number },
) {
  const taxSatang = taxConfiguration.enabled
    ? Math.round(subtotalSatang * taxConfiguration.rate_bps / 10_000)
    : 0;
  return { subtotalSatang, taxSatang, totalSatang: subtotalSatang + taxSatang };
}

export function sameActiveShift(
  posShift: { id: string } | null,
  shiftSummaryShift: { id: string } | null,
) {
  return posShift?.id === shiftSummaryShift?.id;
}
