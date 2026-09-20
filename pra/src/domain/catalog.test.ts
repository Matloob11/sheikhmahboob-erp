import { describe, expect, it } from "vitest";
import {
  FALLBACK_PCT,
  FALLBACK_RATE,
  PUNJAB_SERVICE_RATES,
  PREFERRED_PCT,
  allowDemoClient,
  applyItemToLine,
  applyPctToLine,
  extraPctIds,
  defaultCatalogItemFromSector,
  resolveTaxDefaults,
  searchCatalogItems,
  searchPctCodes,
  validateItemDraft,
  validatePctDraft,
} from "./catalog";
import type { CatalogItem, InvoiceLine, PctCode } from "../types";

function rate(partial: Partial<PctCode> & Pick<PctCode, "pctCode" | "name" | "taxRate">): PctCode {
  return {
    id: partial.id ?? partial.pctCode,
    seeded: true,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function item(partial: Partial<CatalogItem> & Pick<CatalogItem, "itemCode" | "itemName">): CatalogItem {
  return {
    id: "itm_1",
    clientId: "cli_1",
    pctCode: PREFERRED_PCT,
    taxRate: 16,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function line(partial: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: "ln_1",
    itemCode: "IT_001",
    itemName: "",
    quantity: 1,
    pctCode: FALLBACK_PCT,
    taxRate: FALLBACK_RATE,
    saleValue: 0,
    discount: 0,
    furtherTax: 0,
    taxCharged: 0,
    totalAmount: 0,
    ...partial,
  };
}

describe("catalog", () => {
  it("keeps demo clients off production builds", () => {
    expect(allowDemoClient(true)).toBe(false);
    expect(allowDemoClient(false)).toBe(true);
  });

  it("seeds common Punjab service PCT codes as 8 digits", () => {
    expect(PUNJAB_SERVICE_RATES.some((row) => row.pctCode === PREFERRED_PCT && row.taxRate === 16)).toBe(true);
    expect(PUNJAB_SERVICE_RATES.every((row) => /^\d{8}$/.test(row.pctCode))).toBe(true);
  });

  it("does not default to 00000000 / 16% once a catalog exists", () => {
    const rates = PUNJAB_SERVICE_RATES.map((row) => rate(row));
    expect(resolveTaxDefaults(rates)).toEqual({ pctCode: PREFERRED_PCT, taxRate: 16 });
    expect(resolveTaxDefaults(rates, [item({ itemCode: "SRV-1", itemName: "Retainer", pctCode: "98155000", taxRate: 5 })])).toEqual({
      pctCode: "98155000",
      taxRate: 5,
    });
  });

  it("drops duplicate PCT rows from a double seed", () => {
    const first = rate({ id: "pct_a", pctCode: "98154000", name: "Management consultancy", taxRate: 16 });
    const copy = rate({ id: "pct_b", pctCode: "98154000", name: "Management consultancy", taxRate: 16 });
    const other = rate({ id: "pct_c", pctCode: "98155000", name: "IT-enabled services", taxRate: 5 });
    expect(extraPctIds([first, copy, other])).toEqual(["pct_b"]);
  });

  it("falls back only when the catalog is empty", () => {
    expect(resolveTaxDefaults([])).toEqual({ pctCode: FALLBACK_PCT, taxRate: FALLBACK_RATE });
  });

  it("searches buyers-style catalog rows", () => {
    const rates = [rate({ pctCode: "98154000", name: "Management consultancy", taxRate: 16 })];
    expect(searchPctCodes(rates, "manage")).toHaveLength(1);
    expect(searchPctCodes(rates, "98154")).toHaveLength(1);
    expect(searchPctCodes(rates, "hotel")).toHaveLength(0);
    expect(searchCatalogItems([item({ itemCode: "IT_010", itemName: "Monthly retainer" })], "retainer")).toHaveLength(1);
  });

  it("applies item and PCT picks onto a line", () => {
    const picked = applyItemToLine(
      line(),
      item({ itemCode: "CON-1", itemName: "Consulting hour", pctCode: "98154000", taxRate: 16 }),
    );
    expect(picked.itemCode).toBe("CON-1");
    expect(picked.pctCode).toBe("98154000");
    const fromPct = applyPctToLine(line(), rate({ pctCode: "98100000", name: "Beauty parlors", taxRate: 5 }));
    expect(fromPct.pctCode).toBe("98100000");
    expect(fromPct.taxRate).toBe(5);
    expect(fromPct.itemName).toBe("Beauty parlors");
  });

  it("validates PCT and item drafts", () => {
    expect(validatePctDraft({ name: "", pctCode: "12", taxRate: 120 }).length).toBeGreaterThan(1);
    expect(validateItemDraft({ itemCode: "", itemName: "", pctCode: "00000000", taxRate: 16 })).toContain(
      "Item name is required.",
    );
    expect(
      validateItemDraft({ itemCode: "A", itemName: "B", pctCode: "00000000", taxRate: 16, defaultQty: -1 }),
    ).toContain("Default quantity cannot be negative.");
    expect(
      validateItemDraft({ itemCode: "A", itemName: "B", pctCode: "00000000", taxRate: 16, defaultQty: 1 }),
    ).toEqual([]);
  });

  it("maps a sector to one existing Punjab rate", () => {
    const consultancy = defaultCatalogItemFromSector("Consultancy");
    expect(consultancy.pctCode).toBe("98154000");
    expect(consultancy.taxRate).toBe(16);
    expect(consultancy.itemCode).toBe("SEC-98154000");
    expect(consultancy.unit).toBe("Svc");
    expect(consultancy.defaultQty).toBe(1);
    expect(PUNJAB_SERVICE_RATES.some((row) => row.pctCode === consultancy.pctCode)).toBe(true);
    const unknown = defaultCatalogItemFromSector("Not a real sector");
    expect(unknown.pctCode).toBe(FALLBACK_PCT);
    expect(PUNJAB_SERVICE_RATES.some((row) => row.pctCode === unknown.pctCode)).toBe(true);
  });

  it("searches unit on catalog items", () => {
    expect(
      searchCatalogItems([item({ itemCode: "IT_010", itemName: "Monthly retainer", unit: "Svc" })], "svc"),
    ).toHaveLength(1);
  });
});
