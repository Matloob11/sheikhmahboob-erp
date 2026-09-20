import { describe, expect, it } from "vitest";
import type { Invoice, PsidRecord, Purchase } from "../types";
import { attentionJump, computeFileLedger, returnForPeriod, worstAttentionSeverity } from "./ledger";

function invoice(partial: Partial<Invoice> & Pick<Invoice, "id" | "status" | "dateTime" | "totalTaxCharged" | "totalSaleValue">): Invoice {
  return {
    clientId: "cli_1",
    usin: partial.id,
    invoiceType: 1,
    paymentMode: 1,
    buyerName: "",
    buyerPntn: "",
    buyerCnic: "",
    buyerPhone: "",
    discount: 0,
    furtherTax: 0,
    totalQuantity: 1,
    totalBillAmount: 0,
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

describe("computeFileLedger", () => {
  it("nets output tax against input tax and PSID cover", () => {
    const sales = [
      invoice({
        id: "inv_1",
        status: "posted",
        dateTime: "2026-09-14 10:00:00",
        totalTaxCharged: 1600,
        totalSaleValue: 10000,
      }),
    ];
    const purchases: Purchase[] = [
      {
        id: "pur_1",
        clientId: "cli_1",
        period: "2026-09",
        supplierName: "Office",
        supplierPntn: "",
        invoiceNo: "P-1",
        invoiceDate: "2026-09-01",
        saleValue: 2000,
        taxRate: 16,
        taxCharged: 320,
        totalAmount: 2320,
        notes: "",
        createdAt: 1,
      },
    ];
    const psids: PsidRecord[] = [
      {
        id: "psd_1",
        clientId: "cli_1",
        period: "2026-09",
        amount: 500,
        head: "tax",
        psid: "1",
        cpr: "",
        bank: "",
        paidOn: "",
        status: "paid",
        notes: "",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const ledger = computeFileLedger({
      clientId: "cli_1",
      period: "2026-09",
      invoices: sales,
      purchases,
      psids,
      now: new Date(2026, 9, 14),
    });
    expect(ledger.outputTax).toBe(1600);
    expect(ledger.inputTax).toBe(320);
    expect(ledger.netPayable).toBe(1280);
    expect(ledger.psidPaid).toBe(500);
    expect(ledger.psidGap).toBe(780);
    expect(ledger.daysToPayment).toBe(1);
    expect(ledger.blockedInputTax).toBe(0);
    expect(ledger.psidMismatch).toBe(true);
  });

  it("excludes sandbox posts from output tax", () => {
    const ledger = computeFileLedger({
      clientId: "cli_1",
      period: "2026-09",
      invoices: [
        invoice({
          id: "inv_prod",
          status: "posted",
          dateTime: "2026-09-14 10:00:00",
          totalTaxCharged: 1600,
          totalSaleValue: 10000,
          postedEnvironment: "production",
        }),
        invoice({
          id: "inv_sand",
          status: "posted",
          dateTime: "2026-09-14 11:00:00",
          totalTaxCharged: 800,
          totalSaleValue: 5000,
          postedEnvironment: "sandbox",
        }),
      ],
      purchases: [],
      psids: [],
    });
    expect(ledger.outputTax).toBe(1600);
  });

  it("subtracts credit notes from output tax and sale value", () => {
    const ledger = computeFileLedger({
      clientId: "cli_1",
      period: "2026-09",
      invoices: [
        invoice({
          id: "inv_sale",
          status: "posted",
          dateTime: "2026-09-10 10:00:00",
          totalTaxCharged: 1600,
          totalSaleValue: 10000,
          invoiceType: 1,
        }),
        invoice({
          id: "inv_cn",
          status: "posted",
          dateTime: "2026-09-12 10:00:00",
          totalTaxCharged: 160,
          totalSaleValue: 1000,
          invoiceType: 3,
        }),
      ],
      purchases: [],
      psids: [],
      now: new Date(2026, 9, 14),
    });
    expect(ledger.outputTax).toBe(1440);
    expect(ledger.saleValue).toBe(9000);
    expect(ledger.netPayable).toBe(1440);
  });

  it("uses partial paidAmount on paid PSID rows", () => {
    const ledger = computeFileLedger({
      clientId: "cli_1",
      period: "2026-09",
      invoices: [],
      purchases: [],
      psids: [
        {
          id: "psd_1",
          clientId: "cli_1",
          period: "2026-09",
          amount: 500,
          paidAmount: 120,
          head: "tax",
          psid: "1",
          cpr: "",
          bank: "",
          paidOn: "",
          status: "paid",
          notes: "",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(ledger.psidPaid).toBe(120);
  });

  it("excludes blocked input tax from net payable", () => {
    const purchases: Purchase[] = [
      {
        id: "pur_ok",
        clientId: "cli_1",
        period: "2026-09",
        supplierName: "Office",
        supplierPntn: "",
        invoiceNo: "P-1",
        invoiceDate: "2026-09-01",
        saleValue: 2000,
        taxRate: 16,
        taxCharged: 320,
        totalAmount: 2320,
        notes: "",
        createdAt: 1,
      },
      {
        id: "pur_block",
        clientId: "cli_1",
        period: "2026-09",
        supplierName: "Entertainment",
        supplierPntn: "",
        invoiceNo: "P-2",
        invoiceDate: "2026-09-02",
        saleValue: 1000,
        taxRate: 16,
        taxCharged: 160,
        totalAmount: 1160,
        notes: "",
        blockedCredit: true,
        createdAt: 1,
      },
    ];
    const ledger = computeFileLedger({
      clientId: "cli_1",
      period: "2026-09",
      invoices: [
        invoice({
          id: "inv_1",
          status: "posted",
          dateTime: "2026-09-14 10:00:00",
          totalTaxCharged: 1600,
          totalSaleValue: 10000,
        }),
      ],
      purchases,
      psids: [
        {
          id: "psd_1",
          clientId: "cli_1",
          period: "2026-09",
          amount: 1280,
          head: "tax",
          psid: "IRIS-1",
          cpr: "",
          bank: "",
          paidOn: "",
          status: "claimed",
          notes: "",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      now: new Date(2026, 9, 1),
    });
    expect(ledger.inputTax).toBe(320);
    expect(ledger.blockedInputTax).toBe(160);
    expect(ledger.netPayable).toBe(1280);
    expect(ledger.psidPaid).toBe(1280);
    expect(ledger.psidGap).toBe(0);
    expect(ledger.psidMismatch).toBe(false);
  });

  it("counts drafts and failed posts only in the working month", () => {
    const ledger = computeFileLedger({
      clientId: "cli_1",
      period: "2026-09",
      invoices: [
        invoice({
          id: "d1",
          status: "draft",
          dateTime: "2026-09-01 10:00:00",
          totalTaxCharged: 0,
          totalSaleValue: 0,
        }),
        invoice({
          id: "d2",
          status: "draft",
          dateTime: "2026-08-01 10:00:00",
          totalTaxCharged: 0,
          totalSaleValue: 0,
        }),
        invoice({
          id: "f1",
          status: "failed",
          dateTime: "2026-09-02 10:00:00",
          totalTaxCharged: 0,
          totalSaleValue: 0,
        }),
      ],
      purchases: [],
      psids: [],
      now: new Date(2026, 8, 10),
    });
    expect(ledger.draftInvoices).toBe(1);
    expect(ledger.failedInvoices).toBe(1);
  });
});

describe("attentionJump", () => {
  it("sends failed posts to invoices and unpaid PSID to the register", () => {
    expect(attentionJump("2 failed eIMS posts")).toEqual({
      severity: "high",
      path: "/invoices",
      label: "Open invoices",
    });
    expect(attentionJump("1 unpaid PSID row")).toEqual({
      severity: "high",
      path: "/psid",
      label: "Record PSID",
    });
  });

  it("sends credential gaps to the client file", () => {
    expect(attentionJump("eIMS token missing").path).toBe("/clients");
    expect(attentionJump("POS ID missing").severity).toBe("medium");
    expect(attentionJump("PNTN missing")).toEqual({
      severity: "low",
      path: "/clients",
      label: "Open client",
    });
    expect(worstAttentionSeverity(["PNTN missing", "2 failed eIMS posts"])).toBe("high");
    expect(attentionJump("Sandbox token on a production file").path).toBe("/clients");
  });
});

describe("returnForPeriod", () => {
  it("picks the latest updatedAt when two rows share a period", () => {
    const older = {
      id: "ret_old",
      clientId: "cli_1",
      period: "2026-09",
      status: "open" as const,
      notes: "",
      createdAt: 1,
      updatedAt: 10,
    };
    const newer = { ...older, id: "ret_new", status: "filed" as const, updatedAt: 20 };
    expect(returnForPeriod([older, newer], "cli_1", "2026-09")?.id).toBe("ret_new");
    expect(returnForPeriod([newer, older], "cli_1", "2026-09")?.status).toBe("filed");
  });
});
