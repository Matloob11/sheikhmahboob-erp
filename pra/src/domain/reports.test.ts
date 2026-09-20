import { describe, expect, it } from "vitest";
import type { Invoice, InvoiceLine, PsidRecord } from "../types";
import { computeFileLedger } from "./ledger";
import {
  buyerLedger,
  dailyPostedBills,
  failedPosts,
  periodCompare,
  previousPeriod,
  psidGapRows,
  salesBook,
  taxByPct,
} from "./reports";

function line(partial: Partial<InvoiceLine> & Pick<InvoiceLine, "pctCode" | "saleValue" | "taxCharged">): InvoiceLine {
  return {
    id: partial.id ?? `ln_${partial.pctCode}`,
    itemCode: "IT_001",
    itemName: "Work",
    quantity: 1,
    taxRate: 16,
    discount: 0,
    furtherTax: 0,
    totalAmount: partial.saleValue + partial.taxCharged,
    ...partial,
  };
}

function invoice(
  partial: Partial<Invoice> & Pick<Invoice, "id" | "status" | "dateTime" | "totalTaxCharged" | "totalSaleValue">,
): Invoice {
  return {
    clientId: "cli_1",
    usin: partial.usin ?? partial.id,
    invoiceType: 1,
    paymentMode: 1,
    buyerName: "",
    buyerPntn: "",
    buyerCnic: "",
    buyerPhone: "",
    discount: 0,
    furtherTax: 0,
    totalQuantity: 1,
    totalBillAmount: (partial.totalSaleValue ?? 0) + (partial.totalTaxCharged ?? 0),
    refUsin: "",
    items: [],
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

const posted = invoice({
  id: "inv_1",
  status: "posted",
  dateTime: "2026-09-14 10:00:00",
  buyerName: "Khan",
  buyerPntn: "1234567-8",
  totalSaleValue: 10000,
  totalTaxCharged: 1600,
  items: [line({ pctCode: "98321000", saleValue: 10000, taxCharged: 1600, furtherTax: 50 })],
});

describe("previousPeriod", () => {
  it("rolls January to the previous year", () => {
    expect(previousPeriod("2026-01")).toBe("2025-12");
  });
});

describe("salesBook", () => {
  it("shows credit notes as negative sale and tax", () => {
    const credit = invoice({
      id: "inv_cn",
      status: "posted",
      dateTime: "2026-09-15 10:00:00",
      invoiceType: 3,
      totalSaleValue: 1000,
      totalTaxCharged: 160,
      totalBillAmount: 1160,
    });
    const rows = salesBook([posted, credit], "cli_1", "2026-09");
    const cn = rows.find((row) => row.usin === "inv_cn");
    expect(cn?.sale).toBe(-1000);
    expect(cn?.tax).toBe(-160);
    expect(cn?.bill).toBe(-1160);
  });

  it("keeps one client and one period, including drafts", () => {
    const draft = invoice({
      id: "inv_2",
      status: "draft",
      dateTime: "2026-09-02 09:00:00",
      totalSaleValue: 100,
      totalTaxCharged: 16,
    });
    const other = invoice({
      id: "inv_3",
      clientId: "cli_2",
      status: "posted",
      dateTime: "2026-09-14 10:00:00",
      totalSaleValue: 9,
      totalTaxCharged: 1,
    });
    const lastMonth = invoice({
      id: "inv_4",
      status: "posted",
      dateTime: "2026-08-14 10:00:00",
      totalSaleValue: 9,
      totalTaxCharged: 1,
    });
    const rows = salesBook([posted, draft, other, lastMonth], "cli_1", "2026-09");
    expect(rows.map((row) => row.usin)).toEqual(["inv_2", "inv_1"]);
    expect(rows[1]?.lastCode).toBe("");
  });
});

describe("taxByPct", () => {
  it("sums posted lines only", () => {
    const draft = invoice({
      id: "inv_d",
      status: "draft",
      dateTime: "2026-09-03 09:00:00",
      totalSaleValue: 500,
      totalTaxCharged: 80,
      items: [line({ pctCode: "98321000", saleValue: 500, taxCharged: 80 })],
    });
    const rows = taxByPct([posted, draft], "cli_1", "2026-09");
    expect(rows).toEqual([
      { pctCode: "98321000", quantity: 1, sale: 10000, tax: 1600, furtherTax: 50 },
    ]);
  });
});

describe("buyerLedger", () => {
  it("groups registered buyers and walk-ins", () => {
    const walk = invoice({
      id: "inv_w",
      status: "posted",
      dateTime: "2026-09-15 11:00:00",
      totalSaleValue: 200,
      totalTaxCharged: 32,
    });
    const rows = buyerLedger([posted, walk], "cli_1", "2026-09");
    expect(rows.map((row) => row.buyer)).toEqual(["Khan", "walk-in"]);
    expect(rows[0]?.count).toBe(1);
  });
});

describe("failedPosts", () => {
  it("excludes posted rows", () => {
    const failed = invoice({
      id: "inv_f",
      status: "failed",
      dateTime: "2026-09-16 08:00:00",
      lastCode: "101",
      lastError: "Rejected",
      totalSaleValue: 10,
      totalTaxCharged: 1,
    });
    expect(failedPosts([posted, failed], "cli_1", "2026-09").map((row) => row.id)).toEqual(["inv_f"]);
  });
});

describe("periodCompare", () => {
  it("returns deltas against the previous month ledger", () => {
    const current = computeFileLedger({
      clientId: "cli_1",
      period: "2026-09",
      invoices: [posted],
      purchases: [],
      psids: [],
    });
    const previous = computeFileLedger({
      clientId: "cli_1",
      period: "2026-08",
      invoices: [
        invoice({
          id: "inv_old",
          status: "posted",
          dateTime: "2026-08-10 10:00:00",
          totalSaleValue: 4000,
          totalTaxCharged: 640,
        }),
      ],
      purchases: [],
      psids: [],
    });
    expect(periodCompare(current, previous).saleCount).toBe(0);
    expect(periodCompare(current, previous).saleValue).toBe(6000);
    expect(periodCompare(current, previous).outputTax).toBe(960);
  });
});

describe("psidGapRows / dailyPostedBills", () => {
  it("lists unpaid PSIDs and daily posted bills", () => {
    const psids: PsidRecord[] = [
      {
        id: "psd_1",
        clientId: "cli_1",
        period: "2026-09",
        amount: 500,
        head: "tax",
        psid: "",
        cpr: "",
        bank: "",
        paidOn: "",
        status: "planned",
        notes: "",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const ledger = computeFileLedger({
      clientId: "cli_1",
      period: "2026-09",
      invoices: [posted],
      purchases: [],
      psids,
    });
    expect(psidGapRows(ledger).unpaid).toHaveLength(1);
    expect(psidGapRows(ledger).gap).toBe(1600);
    expect(dailyPostedBills([posted], "cli_1", "2026-09")).toEqual([11600]);
  });
});
