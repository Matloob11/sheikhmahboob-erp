import { describe, expect, it } from "vitest";
import { applyBuyerToInvoice, buyerDraftFromInvoice, searchBuyers, validateBuyer } from "./buyers";
import type { Buyer, Invoice } from "../types";

const buyer: Buyer = {
  id: "byr_1",
  clientId: "cli_1",
  name: "Lahore Mills",
  pntn: "1234567-8",
  cnic: "3520212345671",
  phone: "03001234567",
  notes: "",
  createdAt: 1,
  updatedAt: 1,
};

function invoice(): Invoice {
  return {
    id: "inv_1",
    clientId: "cli_1",
    usin: "DFT-1",
    invoiceType: 1,
    paymentMode: 1,
    dateTime: "2026-09-16 10:00:00",
    buyerName: "Walk-in",
    buyerPntn: "",
    buyerCnic: "",
    buyerPhone: "03001111111",
    discount: 0,
    furtherTax: 0,
    totalQuantity: 0,
    totalSaleValue: 0,
    totalTaxCharged: 0,
    totalBillAmount: 0,
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
  };
}

describe("buyers", () => {
  it("requires a name and shaped identifiers", () => {
    expect(validateBuyer({ name: "", pntn: "bad", cnic: "12" }).length).toBeGreaterThan(1);
    expect(validateBuyer({ name: "Ahmad", pntn: "1234567-8", cnic: "" })).toEqual([]);
    expect(validateBuyer({ name: "Ahmad", pntn: "", cnic: "", email: "not-mail" })).toContain(
      "Email address is not valid.",
    );
    expect(validateBuyer({ name: "Ahmad", pntn: "", cnic: "", email: "a@b.com" })).toEqual([]);
  });

  it("searches name, PNTN, CNIC, phone, address and district", () => {
    const withAddress = { ...buyer, address: "Mall Road", district: "Lahore", email: "mills@example.com" };
    expect(searchBuyers([buyer], "mills")).toHaveLength(1);
    expect(searchBuyers([buyer], "1234567")).toHaveLength(1);
    expect(searchBuyers([buyer], "0300")).toHaveLength(1);
    expect(searchBuyers([buyer], "karachi")).toHaveLength(0);
    expect(searchBuyers([withAddress], "mall")).toHaveLength(1);
    expect(searchBuyers([withAddress], "lahore")).toHaveLength(1);
  });

  it("copies a picked buyer onto the invoice header", () => {
    const next = applyBuyerToInvoice(buyer);
    expect(next.buyerId).toBe("byr_1");
    expect(next.buyerName).toBe("Lahore Mills");
    expect(next.buyerPntn).toBe("1234567-8");
    expect(buyerDraftFromInvoice(invoice()).name).toBe("Walk-in");
  });
});
