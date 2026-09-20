import { afterEach, describe, expect, it } from "vitest";
import type { Client, Invoice } from "../types";
import { PRA_SANDBOX_TOKEN } from "../types";
import { buildPayload, postInvoice, recalcLine } from "./pra";

const client: Client = {
  id: "cli_sandbox",
  businessName: "Demo",
  brandName: "Demo",
  pntn: "1234567-8",
  cnic: "",
  phone: "",
  email: "",
  address: "",
  city: "Lahore",
  sector: "Consultancy",
  branchName: "HO",
  posId: "100000",
  posToken: PRA_SANDBOX_TOKEN,
  environment: "sandbox",
  notes: "",
  createdAt: 1,
  updatedAt: 1,
};

function sampleInvoice(): Invoice {
  return {
    id: "inv_path",
    clientId: client.id,
    usin: "DFT-1234567-20260918-001",
    invoiceType: 1,
    paymentMode: 1,
    dateTime: "2026-09-18 10:00:00",
    buyerName: "Walk-in",
    buyerPntn: "",
    buyerCnic: "",
    buyerPhone: "",
    discount: 0,
    furtherTax: 0,
    totalQuantity: 1,
    totalSaleValue: 10000,
    totalTaxCharged: 1600,
    totalBillAmount: 11600,
    refUsin: "",
    items: [
      recalcLine({
        id: "ln_1",
        itemCode: "IT_001",
        itemName: "Consultancy fee",
        quantity: 1,
        pctCode: "98154000",
        taxRate: 16,
        saleValue: 10000,
        discount: 0,
        furtherTax: 0,
        taxCharged: 0,
        totalAmount: 0,
      }),
    ],
    status: "validated",
    fiscalNumber: "",
    lastError: "",
    lastResponse: "",
    lastCode: "",
    attemptCount: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

const okBody = JSON.stringify({ Code: "100", InvoiceNumber: "Not Available", Response: "OK" });
const failBody = JSON.stringify({
  Code: "101",
  InvoiceNumber: "9000052011142444901",
  Response: "Invalid invoice",
});

describe("sandbox PostData path (fake fetch)", () => {
  const original = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = original;
  });

  it("treats proxy Code 100 + Not Available as success", async () => {
    globalThis.fetch = async (input) => {
      expect(String(input)).toBe("/pra-ims/ims/sandbox/api/Live/PostData");
      return new Response(okBody, { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await postInvoice(client, buildPayload(client, sampleInvoice()));
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("success");
    expect(result.code).toBe("100");
  });

  it("returns unknown and does not call the remote URL when the proxy returns 502 HTML", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return new Response("<html>502</html>", { status: 502, headers: { "content-type": "text/html" } });
    };
    const result = await postInvoice(client, buildPayload(client, sampleInvoice()));
    expect(calls).toEqual(["/pra-ims/ims/sandbox/api/Live/PostData"]);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("unknown");
  });

  it("does not treat Code 101 plus a fiscal-looking number as posted", async () => {
    globalThis.fetch = async () =>
      new Response(failBody, { status: 200, headers: { "content-type": "application/json" } });
    const result = await postInvoice(client, buildPayload(client, sampleInvoice()));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("101");
  });
});
