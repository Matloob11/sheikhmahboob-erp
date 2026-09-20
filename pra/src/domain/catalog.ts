import type { CatalogItem, InvoiceLine, PctCode } from "../types";

/** Generic PCT used only when the desk has no catalog yet. */
export const FALLBACK_PCT = "00000000";
export const FALLBACK_RATE = 16;

/** Default new-line PCT once Punjab rates exist (management consultancy, 16%). */
export const PREFERRED_PCT = "98154000";

/**
 * Common Punjab Sales Tax on Services starting rates (FY 2026-27 Second Schedule).
 * Editable on the Items page. Prefer the official schedule when a client's
 * exact heading or reduced-rate condition differs.
 */
export const PUNJAB_SERVICE_RATES: ReadonlyArray<{
  pctCode: string;
  name: string;
  taxRate: number;
}> = [
  { pctCode: "98011000", name: "Hotels, motels and guest houses", taxRate: 16 },
  { pctCode: "98012000", name: "Restaurants and food outlets", taxRate: 16 },
  { pctCode: "98013000", name: "Marriage halls, lawns and catering", taxRate: 8 },
  { pctCode: "98040000", name: "Carriage of goods by rail or road", taxRate: 15 },
  { pctCode: "98057000", name: "Advertising agents", taxRate: 16 },
  { pctCode: "98062000", name: "Property dealers and realtors", taxRate: 8 },
  { pctCode: "98070000", name: "Property developers and promoters", taxRate: 16 },
  { pctCode: "98080000", name: "Courier services", taxRate: 16 },
  { pctCode: "98100000", name: "Beauty parlors, salons and spas", taxRate: 5 },
  { pctCode: "98120000", name: "Telecommunication services", taxRate: 19.5 },
  { pctCode: "98130000", name: "Insurance (other than individual health)", taxRate: 16 },
  { pctCode: "98141000", name: "Architects, town planners and interior designers", taxRate: 8 },
  { pctCode: "98142000", name: "Construction services (private)", taxRate: 16 },
  { pctCode: "98153000", name: "Accountancy, audit and tax consultancy", taxRate: 8 },
  { pctCode: "98154000", name: "Management consultancy", taxRate: 16 },
  { pctCode: "98155000", name: "IT-enabled services", taxRate: 5 },
  { pctCode: "98159000", name: "Technical, scientific and engineering consultants", taxRate: 16 },
  { pctCode: "98230000", name: "Franchise services", taxRate: 16 },
  { pctCode: FALLBACK_PCT, name: "Unspecified / other services", taxRate: FALLBACK_RATE },
];

export function allowDemoClient(prod = import.meta.env.PROD): boolean {
  return !prod;
}

export function matchesQuery(query: string, parts: ReadonlyArray<string>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return parts.some((part) => part.toLowerCase().includes(needle));
}

export function searchPctCodes(rows: ReadonlyArray<PctCode>, query: string): PctCode[] {
  return rows.filter((row) => matchesQuery(query, [row.name, row.pctCode, String(row.taxRate)]));
}

/** Keep the first row per PCT code. Extra ids are safe to delete after a double seed. */
export function extraPctIds<T extends { id: string; pctCode: string }>(rows: ReadonlyArray<T>): string[] {
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const row of rows) {
    if (seen.has(row.pctCode)) extra.push(row.id);
    else seen.add(row.pctCode);
  }
  return extra;
}

export function searchCatalogItems(rows: ReadonlyArray<CatalogItem>, query: string): CatalogItem[] {
  return rows.filter((row) =>
    matchesQuery(query, [row.itemName, row.itemCode, row.pctCode, String(row.taxRate), row.unit ?? ""]),
  );
}

const SECTOR_DEFAULT_PCT: Record<string, string> = {
  Restaurants: "98012000",
  Hotel: "98011000",
  Courier: "98080000",
  "Beauty parlor": "98100000",
  "IT / IT-enabled": "98155000",
  Construction: "98142000",
  Consultancy: "98154000",
  Franchise: "98230000",
  Transport: "98040000",
  "Other services": FALLBACK_PCT,
};

export function defaultCatalogItemFromSector(sector: string): Pick<
  CatalogItem,
  "itemCode" | "itemName" | "pctCode" | "taxRate" | "unit" | "defaultQty" | "inactive"
> {
  const mapped = SECTOR_DEFAULT_PCT[sector] ?? FALLBACK_PCT;
  const rate =
    PUNJAB_SERVICE_RATES.find((row) => row.pctCode === mapped) ??
    PUNJAB_SERVICE_RATES.find((row) => row.pctCode === FALLBACK_PCT) ?? {
      pctCode: FALLBACK_PCT,
      name: "Unspecified / other services",
      taxRate: FALLBACK_RATE,
    };
  return {
    itemCode: `SEC-${rate.pctCode}`,
    itemName: rate.name,
    pctCode: rate.pctCode,
    taxRate: rate.taxRate,
    unit: "Svc",
    defaultQty: 1,
    inactive: false,
  };
}

export function resolveTaxDefaults(
  rates: ReadonlyArray<PctCode>,
  items: ReadonlyArray<CatalogItem> = [],
): { pctCode: string; taxRate: number } {
  const fromItem = items[0];
  if (fromItem) return { pctCode: fromItem.pctCode, taxRate: fromItem.taxRate };
  const preferred =
    rates.find((row) => row.pctCode === PREFERRED_PCT) ??
    rates.find((row) => row.pctCode !== FALLBACK_PCT);
  if (preferred) return { pctCode: preferred.pctCode, taxRate: preferred.taxRate };
  return { pctCode: FALLBACK_PCT, taxRate: FALLBACK_RATE };
}

export function applyItemToLine(line: InvoiceLine, item: CatalogItem): InvoiceLine {
  return {
    ...line,
    itemCode: item.itemCode,
    itemName: item.itemName,
    pctCode: item.pctCode,
    taxRate: item.taxRate,
  };
}

export function applyPctToLine(line: InvoiceLine, rate: PctCode): InvoiceLine {
  return {
    ...line,
    pctCode: rate.pctCode,
    taxRate: rate.taxRate,
    itemName: line.itemName.trim() ? line.itemName : rate.name,
  };
}

export function validatePctDraft(input: { name: string; pctCode: string; taxRate: number }): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("PCT description is required.");
  if (!/^\d{8}$/.test(input.pctCode.trim())) errors.push("PCT/HS code must be 8 digits.");
  if (input.taxRate < 0 || input.taxRate > 100) errors.push("Tax rate must be between 0 and 100.");
  return errors;
}

export function validateItemDraft(input: {
  itemCode: string;
  itemName: string;
  pctCode: string;
  taxRate: number;
  defaultQty?: number;
}): string[] {
  const errors: string[] = [];
  if (!input.itemCode.trim()) errors.push("Item code is required.");
  if (!input.itemName.trim()) errors.push("Item name is required.");
  if (!/^\d{8}$/.test(input.pctCode.trim())) errors.push("PCT/HS code must be 8 digits.");
  if (input.taxRate < 0 || input.taxRate > 100) errors.push("Tax rate must be between 0 and 100.");
  if (input.defaultQty != null && input.defaultQty < 0) errors.push("Default quantity cannot be negative.");
  return errors;
}
