import type { PosCategory, PosProduct } from "@/lib/pos-types";

export type CatalogCategoryRow = {
  id: string;
  name: string;
  emoji: string | null;
  sort_order: number;
  active: boolean;
};

export type CatalogProductRow = PosProduct & { active: boolean };

export function getDefaultProductCategoryId(
  categories: Array<{ id: string; active?: boolean }>,
) {
  return categories.find((category) => category.active)?.id ?? "";
}

// A disabled category must not make an otherwise saleable product disappear.
// Keep such products in a clearly labelled fallback group until a manager
// assigns them to an active category.
export function buildPosCatalog(
  categories: CatalogCategoryRow[],
  products: CatalogProductRow[],
): PosCategory[] {
  const activeCategoryIds = new Set(categories.filter((category) => category.active).map((category) => category.id));
  const activeProducts = products.filter((product) => product.active);
  const catalog: PosCategory[] = [];

  if (activeCategoryIds.size > 0) {
    catalog.push({
      id: "active",
      name: "สินค้าแสดงผล",
      emoji: null,
      active: true,
      products: activeProducts.filter((product) => activeCategoryIds.has(product.category_id)),
    });
  }

  const uncategorizedProducts = activeProducts
    .filter((product) => !activeCategoryIds.has(product.category_id))
    .map((product) => ({ ...product, category_id: "uncategorized" }));
  if (uncategorizedProducts.length) {
    catalog.push({
      id: "uncategorized", name: "สินค้าไม่มีหมวดหมู่ที่ใช้งาน", emoji: null,
      active: true, products: uncategorizedProducts,
    });
  }
  return catalog;
}

export function filterPosProducts(
  products: PosProduct[],
  categoryId: string,
  search: string,
) {
  const query = search.trim().toLocaleLowerCase();
  return products.filter((product) => {
    const matchesCategory = categoryId === "all"
      ? true
      : categoryId === "active"
        ? product.active !== false
        : product.category_id === categoryId;
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
