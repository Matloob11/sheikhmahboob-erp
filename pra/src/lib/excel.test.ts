import { describe, expect, it } from "vitest";
import type { Invoice } from "../types";
import { recalcLine } from "./pra";
import {
  annexCExportRows,
  annexCRows,
  normalizeImportHeaders,
  parseSalesWorkbook,
  salesHeaderIndex,
} from "./excel";

function invoice(): Invoice {
  return {
    id: "inv_1",
    clientId: "cli_1",
    usin: "DFT-1",
    invoiceType: 1,
    paymentMode: 1,
    dateTime: "2026-09-14 10:00:00",
    buyerName: "Buyer",
    buyerPntn: "",
    buyerCnic: "",
    buyerPhone: "",
    discount: 0,
    furtherTax: 0,
    totalQuantity: 2,
    totalSaleValue: 3000,
    totalTaxCharged: 480,
    totalBillAmount: 3480,
    refUsin: "",
    items: [
      recalcLine({
        id: "ln_1",
        itemCode: "IT_001",
        itemName: "A",
        quantity: 1,
        pctCode: "98151000",
        taxRate: 16,
        saleValue: 1000,
        discount: 0,
        furtherTax: 10,
        taxCharged: 0,
        totalAmount: 0,
      }),
      recalcLine({
        id: "ln_2",
        itemCode: "IT_002",
        itemName: "B",
        quantity: 1,
        pctCode: "98154000",
        taxRate: 5,
        saleValue: 2000,
        discount: 0,
        furtherTax: 20,
        taxCharged: 0,
        totalAmount: 0,
      }),
    ],
    status: "posted",
    fiscalNumber: "9001",
    lastError: "",
    lastResponse: "",
    lastCode: "100",
    attemptCount: 1,
    extraTax: 25,
    stWithheld: 80,
    reverseCharge: true,
    saleType: "Services",
    buyerDistrict: "Lahore",
    createdAt: 1,
    updatedAt: 1,
  };
}

async function workbookFile(headers: string[], data: Array<Array<string | number>>): Promise<File> {
  const mod = await import("exceljs");
  const ExcelJS = mod.default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("SALES_INVOICES");
  sheet.addRow(headers);
  for (const row of data) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const copy = bytes.slice();
  return {
    arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
  } as File;
}

describe("sales header index", () => {
  it("reads USIN from Excel column 1 on a 1-based header row", () => {
    const headers: Array<string | undefined> = [];
    headers[1] = "USIN";
    headers[2] = "DateTime";
    expect(salesHeaderIndex(headers, "USIN")).toBe(1);
    expect(salesHeaderIndex(headers, "DateTime")).toBe(2);
  });

  it("reads USIN from a packed 0-based header list", () => {
    expect(salesHeaderIndex(["USIN", "DateTime"], "USIN")).toBe(1);
    expect(salesHeaderIndex(["USIN", "DateTime"], "DateTime")).toBe(2);
  });
});

describe("parseSalesWorkbook", () => {
  it("reads USIN when it is the first column", { timeout: 20_000 }, async () => {
    const file = await workbookFile(
      ["USIN", "DateTime", "ItemCode", "ItemName", "Quantity", "PCTCode", "TaxRate", "SaleValue"],
      [["DFT-COL-0", "2026-09-14 10:00:00", "IT_001", "Fee", 1, "00000000", 16, 10000]],
    );
    const rows = await parseSalesWorkbook(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.USIN).toBe("DFT-COL-0");
  });

  it("accepts IRIS headers and pads a date-only cell", { timeout: 20_000 }, async () => {
    const file = await workbookFile(
      ["Document number", "Document date", "Buyer name", "Buyer NTN / PNTN", "HS code", "Value of sales excl. ST", "ItemName"],
      [["DFT-IRIS-1", "2026-09-14", "Buyer Co", "1234567-8", "98151000", 5000, "Fee"]],
    );
    const rows = await parseSalesWorkbook(file);
    expect(rows[0]?.USIN).toBe("DFT-IRIS-1");
    expect(rows[0]?.DateTime).toBe("2026-09-14 00:00:00");
    expect(rows[0]?.BuyerPNTN).toBe("1234567-8");
    expect(rows[0]?.PCTCode).toBe("98151000");
    expect(rows[0]?.SaleValue).toBe(5000);
  });

  it("parses optional HeaderDiscount", { timeout: 20_000 }, async () => {
    const file = await workbookFile(
      ["USIN", "SaleValue", "Discount", "HeaderDiscount", "ItemCode", "ItemName"],
      [["DFT-HD", 10000, 50, 100, "IT_001", "Fee"]],
    );
    const rows = await parseSalesWorkbook(file);
    expect(rows[0]?.Discount).toBe(50);
    expect(rows[0]?.HeaderDiscount).toBe(100);
  });
});

describe("annexCRows", () => {
  it("emits one working-paper row per invoice line", () => {
    const rows = annexCRows(invoice());
    expect(rows).toHaveLength(2);
    expect(rows[0]?.pctCode).toBe("98151000");
    expect(rows[0]?.taxRate).toBe(16);
    expect(rows[0]?.saleValue).toBe(1000);
    expect(rows[0]?.furtherTax).toBe(10);
    expect(rows[1]?.pctCode).toBe("98154000");
    expect(rows[1]?.taxRate).toBe(5);
    expect(rows[1]?.saleValue).toBe(2000);
    expect(rows[1]?.furtherTax).toBe(20);
  });

  it("keeps stored tax on posted lines even when recalcLine would change them", () => {
    const historical = invoice();
    historical.items = [
      {
        id: "ln_old",
        itemCode: "IT_001",
        itemName: "Old fee",
        quantity: 1,
        pctCode: "98151000",
        taxRate: 16,
        saleValue: 10000,
        discount: 1000,
        furtherTax: 0,
        taxCharged: 1600,
        totalAmount: 10600,
      },
    ];
    historical.discount = 1000;
    historical.totalSaleValue = 10000;
    historical.totalTaxCharged = 1600;
    historical.totalBillAmount = 10600;
    expect(recalcLine(historical.items[0]!).taxCharged).toBe(1440);
    const rows = annexCRows(historical);
    expect(rows[0]?.taxCharged).toBe(1600);
    expect(rows[0]?.saleValue).toBe(10000);
  });
});

describe("annexCExportRows", () => {
  it("repeats header extras on each line and keeps distinct PCT/sale", () => {
    const rows = annexCExportRows([invoice()]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.pctCode).toBe("98151000");
    expect(rows[0]?.saleValue).toBe(1000);
    expect(rows[1]?.pctCode).toBe("98154000");
    expect(rows[1]?.taxRate).toBe(5);
    expect(rows[0]?.buyerDistrict).toBe("Lahore");
    expect(rows[1]?.buyerDistrict).toBe("Lahore");
    expect(rows[0]?.stWithheld).toBe(80);
    expect(rows[0]?.reverseCharge).toBe("Yes");
    expect(rows[0]?.saleType).toBe("Services");
    expect(rows[0]?.extraTax).toBe(25);
  });
});

describe("normalizeImportHeaders", () => {
  it("maps Daftar USIN in column 0 and IRIS Buyer NTN / PNTN", () => {
    const packed = normalizeImportHeaders(["USIN", "Buyer NTN / PNTN", "HS code"]);
    expect(packed.USIN).toBe(1);
    expect(packed.BuyerPNTN).toBe(2);
    expect(packed.PCTCode).toBe(3);
    const iris: Array<string | undefined> = [];
    iris[1] = "Document number";
    iris[2] = "Buyer NTN / PNTN";
    const mapped = normalizeImportHeaders(iris);
    expect(mapped.USIN).toBe(1);
    expect(mapped.BuyerPNTN).toBe(2);
  });
});
