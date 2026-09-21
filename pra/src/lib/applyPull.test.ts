import { describe, expect, it } from "vitest";
import { mergeClientForPull, mergeInvoiceForPull } from "./applyPull";
import type { Client, Invoice } from "../types";

describe("applyPull merge", () => {
  const baseClient = (over: Partial<Client> = {}): Client =>
    ({
      id: "c1",
      businessName: "Local",
      brandName: "",
      pntn: "",
      cnic: "",
      phone: "",
      email: "",
      address: "",
      city: "",
      sector: "",
      branchName: "",
      posId: "P",
      posToken: "keep-local-token",
      environment: "sandbox",
      notes: "",
      createdAt: 1,
      updatedAt: 5,
      ...over,
    }) as Client;

  it("never blanks local posToken from empty remote", () => {
    const { row } = mergeClientForPull(baseClient(), {
      id: "c1",
      businessName: "Remote",
      posToken: "",
      updatedAt: 9,
      createdAt: 1,
    });
    expect(row.posToken).toBe("keep-local-token");
    expect(row.businessName).toBe("Remote");
  });

  it("never downgrades posted invoice", () => {
    const local = {
      id: "i1",
      clientId: "c1",
      status: "posted",
      fiscalNumber: "F1",
      updatedAt: 1,
      usin: "U",
      invoiceType: 1,
      paymentMode: 1,
      dateTime: "",
      buyerName: "",
      buyerPntn: "",
      buyerCnic: "",
      buyerPhone: "",
      discount: 0,
      furtherTax: 0,
      totalQuantity: 0,
      totalSaleValue: 0,
      totalTaxCharged: 0,
      totalBillAmount: 0,
      refUsin: "",
      items: [],
      lastError: "",
      lastResponse: "",
      lastCode: "",
      attemptCount: 0,
      createdAt: 1,
    } as Invoice;
    const { row, conflict } = mergeInvoiceForPull(local, {
      id: "i1",
      clientId: "c1",
      status: "draft",
      fiscalNumber: "",
      updatedAt: 99,
    });
    expect(conflict?.reason).toBe("never_downgrade_posted");
    expect(row.status).toBe("posted");
    expect(row.fiscalNumber).toBe("F1");
  });

  it("keeps local when local is newer", () => {
    const { row, conflict } = mergeClientForPull(baseClient({ updatedAt: 10 }), {
      id: "c1",
      businessName: "Older remote",
      updatedAt: 2,
    });
    expect(conflict?.reason).toBe("local_newer");
    expect(row.businessName).toBe("Local");
  });
});
