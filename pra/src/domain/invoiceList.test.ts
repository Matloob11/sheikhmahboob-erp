import { describe, expect, it } from "vitest";
import type { Invoice } from "../types";
import { filterInvoiceList, parseInvoiceListSearch, writeInvoiceListSearch } from "./invoiceList";

function invoice(partial: Partial<Invoice> & Pick<Invoice, "id" | "usin">): Invoice {
  return {
    clientId: "cli_1",
    invoiceType: 1,
    paymentMode: 1,
    dateTime: "2026-09-14 10:00:00",
    buyerName: "Khan",
    buyerPntn: "1234567-8",
    buyerCnic: "",
    buyerPhone: "",
    discount: 0,
    furtherTax: 0,
    totalQuantity: 1,
    totalSaleValue: 100,
    totalTaxCharged: 16,
    totalBillAmount: 116,
    refUsin: "",
    items: [],
    status: "draft",
    fiscalNumber: "",
    lastError: "",
    lastResponse: "",
    lastCode: "",
    attemptCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

const rows = [
  invoice({ id: "a", usin: "DFT-1-20260914-001", fiscalNumber: "9001" }),
  invoice({
    id: "b",
    usin: "DFT-1-20260801-001",
    dateTime: "2026-08-01 09:00:00",
    buyerName: "Ali",
    buyerPntn: "",
    status: "posted",
  }),
  invoice({
    id: "c",
    usin: "DFT-1-20260920-002",
    dateTime: "2026-09-20 12:00:00",
    status: "failed",
    buyerName: "Zara",
    buyerPntn: "",
  }),
];

describe("filterInvoiceList", () => {
  it("matches USIN, fiscal, and buyer text", () => {
    expect(filterInvoiceList(rows, { query: "9001" }).map((row) => row.id)).toEqual(["a"]);
    expect(filterInvoiceList(rows, { query: "ali" }).map((row) => row.id)).toEqual(["b"]);
    expect(filterInvoiceList(rows, { query: "1234567" }).map((row) => row.id)).toEqual(["a"]);
  });

  it("filters a date range on the YYYY-MM-DD prefix", () => {
    expect(filterInvoiceList(rows, { from: "2026-09-01", to: "2026-09-15" }).map((row) => row.id)).toEqual(["a"]);
  });

  it("keeps status and period scope", () => {
    expect(filterInvoiceList(rows, { status: "failed" }).map((row) => row.id)).toEqual(["c"]);
    expect(filterInvoiceList(rows, { scope: "period", period: "2026-09" }).map((row) => row.id)).toEqual(["a", "c"]);
  });

  it("matches an exact buyer name or PNTN", () => {
    expect(filterInvoiceList(rows, { buyer: "Ali" }).map((row) => row.id)).toEqual(["b"]);
    expect(filterInvoiceList(rows, { buyer: "1234567-8" }).map((row) => row.id)).toEqual(["a"]);
  });
});

describe("invoice list search params", () => {
  it("reads only known status, scope, dates, and buyer", () => {
    expect(parseInvoiceListSearch("?status=draft&scope=all&q=DFT&from=2026-09-01&to=2026-09-19&buyer=Ali")).toEqual({
      status: "draft",
      scope: "all",
      query: "DFT",
      from: "2026-09-01",
      to: "2026-09-19",
      buyer: "Ali",
    });
  });

  it("falls back to defaults for junk values", () => {
    expect(parseInvoiceListSearch("status=nope&scope=week&from=19-09-2026&q=%20")).toEqual({
      status: "all",
      scope: "period",
      query: "",
      from: "",
      to: "",
      buyer: "",
    });
  });

  it("omits defaults when writing so a clean list stays a clean URL", () => {
    expect(
      writeInvoiceListSearch({
        status: "all",
        scope: "period",
        query: "",
        from: "",
        to: "",
        buyer: "",
      }),
    ).toBe("");
    expect(
      writeInvoiceListSearch({
        status: "failed",
        scope: "all",
        query: "  Zara ",
        from: "2026-09-20",
        to: "",
        buyer: "Zara",
      }),
    ).toBe("status=failed&scope=all&q=Zara&from=2026-09-20&buyer=Zara");
  });

  it("round-trips a written query", () => {
    const written = writeInvoiceListSearch({
      status: "posted",
      scope: "all",
      query: "9001",
      from: "2026-08-01",
      to: "2026-09-30",
      buyer: "Khan",
    });
    expect(parseInvoiceListSearch(written)).toEqual({
      status: "posted",
      scope: "all",
      query: "9001",
      from: "2026-08-01",
      to: "2026-09-30",
      buyer: "Khan",
    });
  });
});
