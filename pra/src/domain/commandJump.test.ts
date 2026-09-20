import { describe, expect, it } from "vitest";
import type { Buyer, Client, Invoice } from "../types";
import { matchJumpHits } from "./commandJump";

const client: Client = {
  id: "cli_1",
  businessName: "Khan Advisory",
  brandName: "",
  pntn: "1234567-8",
  cnic: "",
  phone: "",
  email: "",
  address: "",
  city: "Lahore",
  sector: "Consultancy",
  branchName: "",
  posId: "",
  posToken: "",
  environment: "sandbox",
  notes: "",
  ntn: "1234567-8",
  personName: "IFTIKHAR AHMAD",
  createdAt: 1,
  updatedAt: 1,
};

const invoice = {
  id: "inv_1",
  clientId: "cli_1",
  usin: "DFT-1234567-20260914-001",
  fiscalNumber: "90000520191112000369",
  invoiceType: 1,
  paymentMode: 1,
  dateTime: "2026-09-14 10:00:00",
  buyerName: "Buyer",
  buyerPntn: "",
  buyerCnic: "",
  buyerPhone: "",
  discount: 0,
  furtherTax: 0,
  totalQuantity: 1,
  totalSaleValue: 1,
  totalTaxCharged: 0,
  totalBillAmount: 1,
  refUsin: "",
  items: [],
  status: "posted",
  lastError: "",
  lastResponse: "",
  lastCode: "100",
  attemptCount: 1,
  createdAt: 9,
  updatedAt: 9,
} as Invoice;

const buyer = {
  id: "by_1",
  clientId: "cli_1",
  name: "Saeed Traders",
  pntn: "7654321-0",
  cnic: "3520212345671",
  phone: "",
  notes: "",
  createdAt: 1,
  updatedAt: 1,
} as Buyer;

describe("matchJumpHits", () => {
  it("returns routes when the query is empty", () => {
    const hits = matchJumpHits({ query: "" });
    expect(hits.every((row) => row.kind === "route")).toBe(true);
    expect(hits.some((row) => row.path === "/reports")).toBe(true);
  });

  it("finds a client PNTN and a USIN", () => {
    const hits = matchJumpHits({
      query: "1234567",
      clients: [client],
      invoices: [invoice],
      buyers: [buyer],
    });
    expect(hits.some((row) => row.kind === "client" && row.clientId === "cli_1")).toBe(true);
    expect(hits.some((row) => row.kind === "invoice" && row.label === invoice.usin)).toBe(true);
  });

  it("finds a buyer name", () => {
    const hits = matchJumpHits({ query: "saeed", buyers: [buyer] });
    expect(hits.some((row) => row.kind === "buyer" && row.label === "Saeed Traders")).toBe(true);
  });
});
