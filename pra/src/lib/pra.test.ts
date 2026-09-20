import { describe, expect, it } from "vitest";
import type { Client, Invoice } from "../types";
import { PRA_SANDBOX_TOKEN } from "../types";
import {
  buildPayload,
  interpretPraPost,
  isPraDuplicateText,
  isPraTransportBody,
  isRealFiscalNumber,
  mapPraOutcome,
  parsePraBody,
  postInvoice,
  postedMessage,
  recalcLine,
  shouldFallbackFromProxy,
  validateInvoice,
} from "./pra";

const client: Client = {
  id: "cli_1",
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

function sampleInvoice(partial: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_1",
    clientId: "cli_1",
    usin: "DFT-1234567-20260914-001",
    invoiceType: 1,
    paymentMode: 1,
    dateTime: "2026-09-14 10:00:00",
    buyerName: "Test Buyer",
    buyerPntn: "1234567-8",
    buyerCnic: "",
    buyerPhone: "03001234567",
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
        pctCode: "00000000",
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
    ...partial,
  };
}

describe("PRA payload", () => {
  it("matches the POS manual PostData shape", () => {
    const invoice = sampleInvoice({
      furtherTax: 50,
      items: [
        recalcLine({
          id: "ln_1",
          itemCode: "IT_001",
          itemName: "Consultancy fee",
          quantity: 2,
          pctCode: "00000000",
          taxRate: 16,
          saleValue: 10000,
          discount: 100,
          furtherTax: 50,
          taxCharged: 0,
          totalAmount: 0,
        }),
      ],
    });
    const payload = buildPayload(client, invoice);
    expect(payload.InvoiceNumber).toBe("");
    expect(payload.POSID).toBe(100000);
    expect(payload.USIN).toBe(invoice.usin);
    expect(payload.DateTime).toBe("2026-09-14 10:00:00");
    expect(payload.BuyerPNTN).toBe("1234567-8");
    expect(payload.BuyerCNIC).toBe("");
    expect(payload.BuyerName).toBe("Test Buyer");
    expect(payload.BuyerPhoneNumber).toBe("03001234567");
    expect(payload.PaymentMode).toBe(1);
    expect(payload.InvoiceType).toBe(1);
    expect(payload.RefUSIN).toBeNull();
    expect(payload.FurtherTax).toBe(50);
    expect(payload.Discount).toBe(0);
    expect(payload.Items[0]?.TaxCharged).toBe(1600);
    expect(payload.Items[0]?.FurtherTax).toBe(50);
    expect(payload.Items[0]?.Discount).toBe(100);
    expect(payload.Items[0]?.InvoiceType).toBe(1);
    expect(payload.Items[0]?.RefUSIN).toBeNull();
    expect(payload.TotalTaxCharged).toBe(1600);
    expect(payload).not.toHaveProperty("ExtraTax");
    expect(payload).not.toHaveProperty("STWithheld");
    expect(JSON.stringify(payload)).not.toMatch(/ExtraTax|withheld/i);
  });

  it("copies USIN into RefUSIN for a credit note", () => {
    const invoice = sampleInvoice({
      invoiceType: 3,
      usin: "DFT-1234567-20260914-002",
      refUsin: "DFT-1234567-20260914-001",
    });
    const payload = buildPayload(client, invoice);
    expect(payload.InvoiceNumber).toBe("");
    expect(payload.InvoiceType).toBe(3);
    expect(payload.RefUSIN).toBe("DFT-1234567-20260914-001");
    expect(payload.Items[0]?.InvoiceType).toBe(3);
    expect(payload.Items[0]?.RefUSIN).toBe("DFT-1234567-20260914-001");
  });

  it("rejects DateTime that is not the POS format", () => {
    const errors = validateInvoice(client, sampleInvoice({ dateTime: "14/09/2026" }));
    expect(errors.some((error) => /Date time/.test(error))).toBe(true);
  });

  it("accepts DateTime with optional milliseconds from the field table", () => {
    const errors = validateInvoice(client, sampleInvoice({ dateTime: "2018-11-01 00:00:00.000" }));
    expect(errors.some((error) => /Date time/.test(error))).toBe(false);
  });

  it("requires buyer name when a B2B PNTN is present", () => {
    const errors = validateInvoice(client, sampleInvoice({ buyerName: "", buyerPntn: "1234567-8" }));
    expect(errors).toContain("B2B invoices with a buyer PNTN also need the buyer name.");
  });

  it("requires Ref USIN on debit/credit notes", () => {
    const errors = validateInvoice(client, sampleInvoice({ invoiceType: 2, refUsin: "" }));
    expect(errors).toContain("Debit/credit notes need the original USIN in Ref USIN.");
  });
});

describe("PRA parse and error map", () => {
  it("reads Code 100 and InvoiceNumber", () => {
    const parsed = parsePraBody(
      JSON.stringify({ Code: "100", InvoiceNumber: "Not Available", Response: "OK" }),
    );
    expect(parsed.code).toBe("100");
    expect(parsed.fiscalNumber).toBe("Not Available");
  });

  it("reads numeric InvoiceNumber and Errors", () => {
    const parsed = parsePraBody(
      '{"Code":100,"InvoiceNumber":90000520191112000369,"Response":"Invoice received successfully","Errors":null}',
    );
    expect(parsed.code).toBe("100");
    expect(parsed.fiscalNumber).toBe("90000520191112000369");
    expect(parsed.fiscalNumber).not.toBe(String(90000520191112000369));
  });

  it("does not treat Not Available as a real fiscal number", () => {
    expect(isRealFiscalNumber("Not Available")).toBe(false);
    expect(isRealFiscalNumber("9000052011142444901")).toBe(true);
  });

  it("marks Code 100 success even when sandbox fiscal is Not Available", () => {
    const result = interpretPraPost(
      JSON.stringify({ Code: "100", InvoiceNumber: "Not Available", Response: "OK" }),
      200,
      "sandbox",
    );
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("success");
  });

  it("marks Code 00 as success", () => {
    const result = mapPraOutcome(
      { code: "00", message: "OK", fiscalNumber: "9000052011142444901" },
      200,
    );
    expect(result.ok).toBe(true);
  });

  it("does not mark success from Not Available alone", () => {
    const result = interpretPraPost(
      JSON.stringify({ Code: "101", InvoiceNumber: "Not Available", Response: "Invalid invoice" }),
      200,
      "production",
    );
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("validation");
  });

  it("maps USIN already exists to a no-retry action", () => {
    expect(isPraDuplicateText("USIN already exists for this POS")).toBe(true);
    const result = mapPraOutcome(
      { code: "", message: "USIN already exists", fiscalNumber: "" },
      200,
    );
    expect(result.ok).toBe(false);
    expect(result.alreadyExists).toBe(true);
    expect(result.nextAction).toMatch(/Do not post again/);
  });

  it("does not treat a duplicate with a real fiscal number as posted without a success code", () => {
    const result = mapPraOutcome(
      { code: "", message: "USIN already exists", fiscalNumber: "9000052011142444901" },
      200,
    );
    expect(result.ok).toBe(false);
    expect(result.alreadyExists).toBe(true);
    expect(result.fiscalNumber).toBe("9000052011142444901");
  });

  it("does not mark success from Code 101 plus a real fiscal in the body", () => {
    const result = mapPraOutcome(
      { code: "101", message: "Invalid invoice", fiscalNumber: "9000052011142444901" },
      200,
    );
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("validation");
  });

  it("maps token failures to an auth next action", () => {
    const result = mapPraOutcome({ code: "", message: "Unauthorized", fiscalNumber: "" }, 401);
    expect(result.kind).toBe("auth");
    expect(result.nextAction).toMatch(/token/);
  });

  it("explains sandbox fiscal numbers that are not issued", () => {
    expect(postedMessage("Not Available", "sandbox")).toMatch(/did not issue a fiscal number/);
    expect(postedMessage("PRA-1", "sandbox")).toBe("Posted. Fiscal number PRA-1.");
  });
});

describe("PRA transport (no remote fallback)", () => {
  it("rejects Frappe HTML as a PRA body", () => {
    expect(isPraTransportBody("<!doctype html><html><title>404</title>", "text/html")).toBe(false);
    expect(isPraTransportBody(JSON.stringify({ Code: "100" }), "application/json")).toBe(true);
  });

  it("treats 404 HTML and 502 as ambiguous, not PRA 401 JSON", () => {
    expect(shouldFallbackFromProxy(404, "<html>not found</html>", "text/html")).toBe(true);
    expect(shouldFallbackFromProxy(502, "Bad Gateway", "text/plain")).toBe(true);
    expect(
      shouldFallbackFromProxy(401, JSON.stringify({ Code: "101", Response: "Unauthorized" }), "application/json"),
    ).toBe(false);
  });

  it("returns unknown and never calls ims.pral.com.pk when the proxy returns Frappe HTML", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return new Response("<html>frappe</html>", { status: 404, headers: { "content-type": "text/html" } });
    };
    try {
      const result = await postInvoice(client, buildPayload(client, sampleInvoice()));
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatch(/^\/pra-ims\//);
      expect(calls.some((url) => /ims\.pral\.com\.pk/.test(url))).toBe(false);
      expect(result.ok).toBe(false);
      expect(result.kind).toBe("unknown");
    } finally {
      globalThis.fetch = original;
    }
  });
});
