import { describe, expect, it } from "vitest";
import {
  hasExtraInvoiceFilters,
  invoiceEditorAdvanced,
  nextInvoiceStep,
  prevInvoiceStep,
  shouldShowInvoiceBulkBar,
  shouldShowInvoiceExtraFilters,
  shouldWarnLeave,
} from "./deskChrome";

describe("invoice extra filters", () => {
  it("treats search, dates, or buyer as extra", () => {
    expect(hasExtraInvoiceFilters({ query: "", from: "", to: "", buyer: "" })).toBe(false);
    expect(hasExtraInvoiceFilters({ query: "DFT", from: "", to: "", buyer: "" })).toBe(true);
    expect(hasExtraInvoiceFilters({ query: "", from: "2026-09-01", to: "", buyer: "" })).toBe(true);
    expect(hasExtraInvoiceFilters({ query: "", from: "", to: "", buyer: "Ali" })).toBe(true);
  });

  it("keeps the extra row closed unless the user opens it or a filter is on", () => {
    expect(shouldShowInvoiceExtraFilters(false, false)).toBe(false);
    expect(shouldShowInvoiceExtraFilters(true, false)).toBe(true);
    expect(shouldShowInvoiceExtraFilters(false, true)).toBe(true);
  });

  it("hides bulk actions on an empty list", () => {
    expect(shouldShowInvoiceBulkBar(0, 0)).toBe(false);
    expect(shouldShowInvoiceBulkBar(3, 0)).toBe(true);
    expect(shouldShowInvoiceBulkBar(0, 2)).toBe(true);
  });
});

describe("invoice editor steps", () => {
  it("walks header → lines → review → post", () => {
    expect(nextInvoiceStep("header")).toBe("lines");
    expect(nextInvoiceStep("lines")).toBe("review");
    expect(nextInvoiceStep("review")).toBe("post");
    expect(nextInvoiceStep("post")).toBe("post");
    expect(prevInvoiceStep("header")).toBe("header");
    expect(prevInvoiceStep("lines")).toBe("header");
  });

  it("parks extra tax, withheld, reverse charge, and ref USIN as advanced", () => {
    expect(invoiceEditorAdvanced()).toEqual([
      "extraTax",
      "stWithheld",
      "reverseCharge",
      "headerDiscount",
      "refUsin",
      "taxpayerType",
      "saleType",
      "buyerDistrict",
    ]);
  });
});

describe("shouldWarnLeave", () => {
  it("warns only when the open form is dirty", () => {
    expect(shouldWarnLeave(false)).toBe(false);
    expect(shouldWarnLeave(true)).toBe(true);
  });
});
