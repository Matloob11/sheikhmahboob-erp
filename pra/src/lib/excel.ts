import type { Cell, CellValue, Row, Workbook } from "exceljs";
import { purchaseCredit, signedInvoiceAmount } from "../domain/ledger";
import type { Client, Invoice, InvoiceType, PsidRecord, Purchase } from "../types";
import { INVOICE_TYPES, PAYMENT_MODES } from "../types";
import { periodLabel } from "./ids";
import { money } from "./money";
import { recalcLine } from "./pra";

async function createWorkbook(): Promise<Workbook> {
  const mod = await import("exceljs");
  const ExcelJS = mod.default;
  return new ExcelJS.Workbook();
}

const IRIS_NOTE =
  "Working paper only. File Annex A/C and create the PSID on PRA IRIS — this workbook is not the official return.";

function saleDocumentType(type: InvoiceType): string {
  if (type === 2) return "DN";
  if (type === 3) return "CN";
  return "SI";
}

function buyerType(invoice: Invoice): string {
  return invoice.buyerPntn.trim() ? "Intermediary" : "End consumer";
}

function yesNo(value: boolean | undefined): string {
  return value ? "Yes" : "No";
}

function parseYes(value: string): boolean {
  return /^(1|y|yes|true|on)$/i.test(value.trim());
}

export interface AnnexCLineRow {
  usin: string;
  fiscalNumber: string;
  buyerPntn: string;
  buyerCnic: string;
  buyerName: string;
  documentType: string;
  documentDate: string;
  buyerType: string;
  payment: string;
  eimsType: string;
  status: Invoice["status"];
  pctCode: string;
  taxRate: number;
  saleValue: number;
  taxCharged: number;
  furtherTax: number;
}

export function annexCRows(invoice: Invoice): AnnexCLineRow[] {
  const sign = invoice.invoiceType === 3 ? -1 : 1;
  const shared = {
    usin: invoice.usin,
    fiscalNumber: invoice.fiscalNumber,
    buyerPntn: invoice.buyerPntn,
    buyerCnic: invoice.buyerCnic,
    buyerName: invoice.buyerName,
    documentType: saleDocumentType(invoice.invoiceType),
    documentDate: invoice.dateTime.slice(0, 10),
    buyerType: buyerType(invoice),
    payment: labelOf(PAYMENT_MODES, invoice.paymentMode),
    eimsType: labelOf(INVOICE_TYPES, invoice.invoiceType),
    status: invoice.status,
  };
  if (invoice.items.length === 0) {
    const taxRate =
      invoice.totalSaleValue <= 0 ? 0 : money((invoice.totalTaxCharged / invoice.totalSaleValue) * 100);
    return [
      {
        ...shared,
        pctCode: "",
        taxRate,
        saleValue: money(invoice.totalSaleValue * sign),
        taxCharged: money(invoice.totalTaxCharged * sign),
        furtherTax: money(invoice.furtherTax * sign),
      },
    ];
  }
  return invoice.items.map((line) => {
    const calc = recalcLine(line);
    return {
      ...shared,
      pctCode: calc.pctCode,
      taxRate: calc.taxRate,
      saleValue: money(calc.saleValue * sign),
      taxCharged: money(calc.taxCharged * sign),
      furtherTax: money(calc.furtherTax * sign),
    };
  });
}

export type AnnexCExportRow = Record<string, string | number>;

/** One Excel / Annex C UI row per invoice line, with CONTRACT header extras filled. */
export function annexCExportRows(sales: ReadonlyArray<Invoice>): AnnexCExportRow[] {
  return sales.flatMap((invoice) =>
    annexCRows(invoice).map((row) => ({
      usin: row.usin,
      fiscalNumber: row.fiscalNumber,
      buyerPntn: row.buyerPntn,
      buyerCnic: row.buyerCnic,
      buyerName: row.buyerName,
      buyerDistrict: invoice.buyerDistrict?.trim() ?? "",
      documentType: row.documentType,
      documentDate: row.documentDate,
      pctCode: row.pctCode,
      buyerType: row.buyerType,
      saleType: invoice.saleType?.trim() || "Services",
      taxRate: row.taxRate,
      saleValue: row.saleValue,
      taxCharged: row.taxCharged,
      furtherTax: row.furtherTax,
      extraTax: invoice.extraTax ?? 0,
      stWithheld: invoice.stWithheld ?? 0,
      reverseCharge: yesNo(invoice.reverseCharge),
      payment: row.payment,
      eimsType: row.eimsType,
      status: row.status,
    })),
  );
}

function labelOf<T extends number>(
  list: ReadonlyArray<{ value: T; label: string }>,
  value: T,
): string {
  return list.find((item) => item.value === value)?.label ?? String(value);
}

async function downloadWorkbook(workbook: Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function addSheet(
  workbook: Workbook,
  name: string,
  headers: string[],
  rows: Array<Array<string | number>>,
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0C5C4A" },
  };
  header.font = { bold: true, color: { argb: "FFF3F5F7" } };
  rows.forEach((row) => sheet.addRow(row));
  headers.forEach((_, index) => {
    sheet.getColumn(index + 1).width = 18;
  });
}

export async function exportReturnPack(options: {
  client: Client;
  period: string;
  sales: Invoice[];
  purchases: Purchase[];
  psids: PsidRecord[];
}): Promise<void> {
  const workbook = await createWorkbook();
  workbook.creator = "Daftar";
  const { client, period, sales, purchases, psids } = options;

  addSheet(
    workbook,
    "Annex-C Sales",
    [
      "Sr",
      "Buyer NTN / PNTN",
      "Buyer CNIC",
      "Buyer name",
      "District of buyer",
      "Document type",
      "Document number",
      "Document date",
      "HS code",
      "Buyer type",
      "Sale type",
      "Rate",
      "Value of sales excl. ST",
      "Sales tax involved",
      "Extra / further tax",
      "ST withheld at source",
      "Tax reverse charged u/s 4",
      "USIN",
      "Fiscal no",
      "Payment",
      "eIMS type",
      "Status",
    ],
    annexCExportRows(sales).map((row, index) => [
      index + 1,
      row.buyerPntn ?? "",
      row.buyerCnic ?? "",
      row.buyerName ?? "",
      row.buyerDistrict ?? "",
      row.documentType ?? "",
      row.usin ?? "",
      row.documentDate ?? "",
      row.pctCode ?? "",
      row.buyerType ?? "",
      row.saleType ?? "Services",
      row.taxRate ?? 0,
      row.saleValue ?? 0,
      row.taxCharged ?? 0,
      row.furtherTax ?? 0,
      row.stWithheld ?? 0,
      row.reverseCharge ?? "No",
      row.usin ?? "",
      row.fiscalNumber ?? "",
      row.payment ?? "",
      row.eimsType ?? "",
      row.status ?? "",
    ]),
  );

  addSheet(
    workbook,
    "Annex-A Purchases",
    [
      "Sr",
      "Supplier NTN / PNTN",
      "Supplier CNIC",
      "Supplier name",
      "District of supplier",
      "Document type",
      "Document number",
      "Document date",
      "HS code",
      "Purchase type",
      "Rate",
      "Value of purchases excl. ST",
      "Sales tax involved",
      "ST withheld as WH agent",
      "Tax reverse charged u/s 4",
      "Input credit",
      "Notes",
    ],
    purchases.map((row, index) => [
      index + 1,
      row.supplierPntn,
      row.supplierCnic ?? "",
      row.supplierName,
      row.district ?? "",
      "PI",
      row.invoiceNo,
      row.invoiceDate,
      row.pctCode ?? "",
      "Services",
      row.taxRate,
      row.saleValue,
      row.taxCharged,
      row.withheld ?? 0,
      yesNo(row.reverseCharge),
      row.blockedCredit ? "Blocked / non-adjustable" : "Adjustable",
      row.notes,
    ]),
  );

  addSheet(
    workbook,
    "PSID register",
    ["Period", "Head", "Amount", "Paid amount", "PSID", "CPR", "Bank", "Due on", "Paid on", "Status", "Notes"],
    psids.map((row) => [
      period,
      row.head,
      row.amount,
      row.paidAmount ?? "",
      row.psid,
      row.cpr,
      row.bank,
      row.dueOn ?? "",
      row.paidOn,
      row.status,
      row.notes,
    ]),
  );

  const output = money(
    sales
      .filter((row) => row.postedEnvironment !== "sandbox")
      .reduce((sum, row) => sum + signedInvoiceAmount(row, row.totalTaxCharged), 0),
  );
  const credit = purchaseCredit(purchases);
  const net = money(output - credit.adjustable);
  const paid = money(
    psids
      .filter((row) => row.status === "paid" || row.status === "claimed")
      .reduce((sum, row) => sum + row.amount, 0),
  );
  addSheet(
    workbook,
    "Summary",
    ["Field", "Value"],
    [
      ["Client", client.businessName],
      ["PNTN", client.pntn],
      ["Period", periodLabel(period)],
      ["Sales invoices", sales.length],
      ["Output tax", output],
      ["Purchase invoices", purchases.length],
      ["Input tax (adjustable)", credit.adjustable],
      ["Blocked / non-adjustable credit", credit.blocked],
      ["Net payable (desk estimate)", net],
      ["PSID paid + claimed", paid],
      [
        "PSID cover",
        paid === net
          ? "Matches net payable"
          : "Paid + claimed does not match net payable. Create the official PSID on IRIS.",
      ],
      ["Note", IRIS_NOTE],
      [
        "Annex columns",
        "Aligned to PRA IRIS Sales Tax Return Annex-A (Purchases) and Annex-C (Domestic Sales) in the Sales tax return manual / STR form. Extra eIMS columns are working notes.",
      ],
      ["Manual", "https://e.pra.punjab.gov.pk/templates/PRA_Iris_User_Manual_Version4.pdf"],
      ["eIMS / POS manual", "https://e.pra.punjab.gov.pk/templates/POS_COMPONENT_and_eIMS_User_Manual.pdf"],
    ],
  );

  await downloadWorkbook(
    workbook,
    `daftar-${client.pntn || "client"}-${period}-return.xlsx`,
  );
}

export async function exportSalesTemplate(): Promise<void> {
  const workbook = await createWorkbook();
  addSheet(
    workbook,
    "SALES_INVOICES",
    [
      "USIN",
      "DateTime",
      "InvoiceType",
      "PaymentMode",
      "BuyerName",
      "BuyerPNTN",
      "BuyerCNIC",
      "BuyerPhone",
      "BuyerDistrict",
      "ItemCode",
      "ItemName",
      "Quantity",
      "PCTCode",
      "TaxRate",
      "SaleValue",
      "Discount",
      "FurtherTax",
      "HeaderDiscount",
      "RefUSIN",
      "SaleType",
      "ExtraTax",
      "StWithheld",
      "ReverseCharge",
      "TaxpayerType",
    ],
    [
      [
        "DFT-1234567-20260914-001",
        "2026-09-14 10:00:00",
        1,
        1,
        "Sample Buyer",
        "1234567-8",
        "3520212345671",
        "03001234567",
        "Lahore",
        "IT_1011",
        "Consultancy",
        1,
        "00000000",
        16,
        10000,
        0,
        0,
        0,
        "",
        "Services",
        0,
        0,
        "No",
        "",
      ],
    ],
  );
  await downloadWorkbook(workbook, "daftar-sales-invoice-template.xlsx");
}

export interface ImportedSaleRow {
  USIN: string;
  DateTime: string;
  InvoiceType: number;
  PaymentMode: number;
  BuyerName: string;
  BuyerPNTN: string;
  BuyerCNIC: string;
  BuyerPhone: string;
  BuyerDistrict?: string;
  ItemCode: string;
  ItemName: string;
  Quantity: number;
  PCTCode: string;
  TaxRate: number;
  SaleValue: number;
  Discount: number;
  FurtherTax: number;
  RefUSIN: string;
  HeaderDiscount?: number;
  SaleType?: string;
  ExtraTax?: number;
  StWithheld?: number;
  ReverseCharge?: boolean;
  TaxpayerType?: string;
}

export const CANONICAL_SALE_COLS = [
  "USIN",
  "DateTime",
  "InvoiceType",
  "PaymentMode",
  "BuyerName",
  "BuyerPNTN",
  "BuyerCNIC",
  "BuyerPhone",
  "BuyerDistrict",
  "ItemCode",
  "ItemName",
  "Quantity",
  "PCTCode",
  "TaxRate",
  "SaleValue",
  "Discount",
  "FurtherTax",
  "HeaderDiscount",
  "RefUSIN",
  "SaleType",
  "ExtraTax",
  "StWithheld",
  "ReverseCharge",
  "TaxpayerType",
] as const;

export type CanonicalSaleCol = (typeof CANONICAL_SALE_COLS)[number];

const SALE_HEADER_ALIASES: Record<CanonicalSaleCol, readonly string[]> = {
  USIN: ["USIN", "Document number"],
  DateTime: ["DateTime", "Document date"],
  InvoiceType: ["InvoiceType", "Document type"],
  PaymentMode: ["PaymentMode", "Payment"],
  BuyerName: ["BuyerName", "Buyer name"],
  BuyerPNTN: ["BuyerPNTN", "Buyer NTN / PNTN"],
  BuyerCNIC: ["BuyerCNIC", "Buyer CNIC"],
  BuyerPhone: ["BuyerPhone", "Buyer phone"],
  BuyerDistrict: ["BuyerDistrict", "District of buyer"],
  ItemCode: ["ItemCode", "Item code"],
  ItemName: ["ItemName", "Item name"],
  Quantity: ["Quantity"],
  PCTCode: ["PCTCode", "HS code"],
  TaxRate: ["TaxRate", "Rate"],
  SaleValue: ["SaleValue", "Value of sales excl. ST"],
  Discount: ["Discount"],
  FurtherTax: ["FurtherTax", "Extra / further tax"],
  HeaderDiscount: ["HeaderDiscount"],
  RefUSIN: ["RefUSIN", "Ref USIN"],
  SaleType: ["SaleType", "Sale type"],
  ExtraTax: ["ExtraTax", "Extra tax"],
  StWithheld: ["StWithheld", "ST withheld at source"],
  ReverseCharge: ["ReverseCharge", "Tax reverse charged u/s 4"],
  TaxpayerType: ["TaxpayerType", "Taxpayer type"],
};

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** ExcelJS header cells are 1-based; a packed 0-based list is also accepted. */
export function normalizeImportHeaders(
  headers: ReadonlyArray<string | undefined>,
): Record<CanonicalSaleCol, number | null> {
  const packed = Boolean(headers[0]);
  const result = {} as Record<CanonicalSaleCol, number | null>;
  for (const canonical of CANONICAL_SALE_COLS) {
    const aliases = SALE_HEADER_ALIASES[canonical];
    const found = headers.findIndex((header) => {
      if (!header) return false;
      const key = headerKey(header);
      return aliases.some((alias) => headerKey(alias) === key);
    });
    result[canonical] = found < 0 ? null : packed ? found + 1 : found;
  }
  return result;
}

export function normalizeImportedDateTime(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed} 00:00:00`;
  return trimmed;
}

export function invoiceTypeFromCell(value: string): 1 | 2 | 3 {
  const token = value.trim().toUpperCase();
  if (token === "2" || token === "DN" || token === "DEBIT") return 2;
  if (token === "3" || token === "CN" || token === "CREDIT") return 3;
  if (token === "1" || token === "SI" || token === "NEW") return 1;
  const n = Number(token);
  if (n === 2 || n === 3) return n;
  return 1;
}

/** ExcelJS header cells are 1-based; a packed 0-based list is also accepted. */
export function salesHeaderIndex(
  headers: ReadonlyArray<string | undefined>,
  name: string,
): number | null {
  const packed = Boolean(headers[0]);
  const found = headers.findIndex((header) => header === name);
  if (found < 0) return null;
  return packed ? found + 1 : found;
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String(value.text);
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace("T", " ");
  return String(value);
}

function cellNumber(value: CellValue): number {
  const n = Number(cellText(value));
  return Number.isFinite(n) ? n : 0;
}

export async function parseSalesWorkbook(file: File): Promise<ImportedSaleRow[]> {
  const workbook = await createWorkbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell: Cell, col: number) => {
    headers[col] = cellText(cell.value).trim();
  });
  const mapped = normalizeImportHeaders(headers);
  const indexOf = (name: CanonicalSaleCol): number | null => mapped[name];

  const rows: ImportedSaleRow[] = [];
  sheet.eachRow((row: Row, rowNumber: number) => {
    if (rowNumber === 1) return;
    const read = (name: CanonicalSaleCol) => {
      const col = indexOf(name);
      return col != null ? cellText(row.getCell(col).value) : "";
    };
    const readN = (name: CanonicalSaleCol) => {
      const col = indexOf(name);
      return col != null ? cellNumber(row.getCell(col).value) : 0;
    };
    const usin = read("USIN");
    if (!usin) return;
    const headerDiscountCol = indexOf("HeaderDiscount");
    rows.push({
      USIN: usin,
      DateTime: normalizeImportedDateTime(read("DateTime")),
      InvoiceType: invoiceTypeFromCell(read("InvoiceType") || String(readN("InvoiceType") || 1)),
      PaymentMode: readN("PaymentMode") || 1,
      BuyerName: read("BuyerName"),
      BuyerPNTN: read("BuyerPNTN"),
      BuyerCNIC: read("BuyerCNIC"),
      BuyerPhone: read("BuyerPhone"),
      BuyerDistrict: read("BuyerDistrict"),
      ItemCode: read("ItemCode"),
      ItemName: read("ItemName"),
      Quantity: readN("Quantity") || 1,
      PCTCode: read("PCTCode") || "00000000",
      TaxRate: readN("TaxRate") || 16,
      SaleValue: readN("SaleValue"),
      Discount: readN("Discount"),
      FurtherTax: readN("FurtherTax"),
      RefUSIN: read("RefUSIN"),
      HeaderDiscount: headerDiscountCol != null ? readN("HeaderDiscount") : undefined,
      SaleType: read("SaleType"),
      ExtraTax: indexOf("ExtraTax") != null ? readN("ExtraTax") : undefined,
      StWithheld: indexOf("StWithheld") != null ? readN("StWithheld") : undefined,
      ReverseCharge: indexOf("ReverseCharge") != null ? parseYes(read("ReverseCharge")) : undefined,
      TaxpayerType: read("TaxpayerType"),
    });
  });
  return rows;
}

export interface ImportedPurchaseRow {
  supplierName: string;
  supplierPntn: string;
  supplierCnic: string;
  invoiceNo: string;
  invoiceDate: string;
  saleValue: number;
  taxRate: number;
  district: string;
  pctCode: string;
  withheld: number;
  reverseCharge: boolean;
  notes: string;
}

const PURCHASE_ALIASES: Record<string, readonly string[]> = {
  supplierName: ["Supplier name", "Supplier"],
  supplierPntn: ["Supplier NTN / PNTN", "Supplier PNTN", "Supplier NTN"],
  supplierCnic: ["Supplier CNIC"],
  invoiceNo: ["Document number", "Invoice no", "Invoice number"],
  invoiceDate: ["Document date", "Date"],
  saleValue: ["Value of purchases excl. ST", "Sale value"],
  taxRate: ["Rate", "Tax rate"],
  district: ["District of supplier", "District"],
  pctCode: ["HS code", "PCTCode", "PCT"],
  withheld: ["ST withheld as WH agent", "ST withheld"],
  reverseCharge: ["Tax reverse charged u/s 4", "Reverse charge"],
  notes: ["Notes"],
};

function purchaseHeaderIndex(
  headers: ReadonlyArray<string | undefined>,
  aliases: readonly string[],
): number | null {
  const packed = Boolean(headers[0]);
  const found = headers.findIndex((header) => {
    if (!header) return false;
    const key = headerKey(header);
    return aliases.some((alias) => headerKey(alias) === key);
  });
  if (found < 0) return null;
  return packed ? found + 1 : found;
}

export async function parsePurchasesWorkbook(file: File): Promise<ImportedPurchaseRow[]> {
  const workbook = await createWorkbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet =
    workbook.worksheets.find((item) => /annex.?a|purchase/i.test(item.name)) ?? workbook.worksheets[0];
  if (!sheet) return [];
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell: Cell, col: number) => {
    headers[col] = cellText(cell.value).trim();
  });
  const rows: ImportedPurchaseRow[] = [];
  sheet.eachRow((row: Row, rowNumber: number) => {
    if (rowNumber === 1) return;
    const read = (key: string) => {
      const col = purchaseHeaderIndex(headers, PURCHASE_ALIASES[key] ?? [key]);
      return col != null ? cellText(row.getCell(col).value) : "";
    };
    const readN = (key: string) => {
      const col = purchaseHeaderIndex(headers, PURCHASE_ALIASES[key] ?? [key]);
      return col != null ? cellNumber(row.getCell(col).value) : 0;
    };
    const supplierName = read("supplierName");
    const invoiceNo = read("invoiceNo");
    if (!supplierName && !invoiceNo) return;
    rows.push({
      supplierName,
      supplierPntn: read("supplierPntn"),
      supplierCnic: read("supplierCnic"),
      invoiceNo,
      invoiceDate: read("invoiceDate").slice(0, 10),
      saleValue: readN("saleValue"),
      taxRate: readN("taxRate") || 16,
      district: read("district"),
      pctCode: read("pctCode"),
      withheld: readN("withheld"),
      reverseCharge: parseYes(read("reverseCharge")),
      notes: read("notes"),
    });
  });
  return rows;
}
