import {
  type Client,
  type Invoice,
  type InvoiceLine,
} from "../types";
import { digitsOnly } from "./ids";
import { money } from "./money";
import { uiStrings } from "./uiStrings";

/** POS manual §6.1 sample JSON uses `YYYY-MM-DD HH:MM:SS`; the field table also shows `.mmm`. */
export const PRA_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;

export const PRA_SUCCESS_CODES = ["100", "00"] as const;

export interface PraItemPayload {
  ItemCode: string;
  ItemName: string;
  Quantity: number;
  PCTCode: string;
  TaxRate: number;
  SaleValue: number;
  TotalAmount: number;
  TaxCharged: number;
  Discount: number;
  FurtherTax: number;
  InvoiceType: number;
  RefUSIN: string | null;
}

export interface PraInvoicePayload {
  InvoiceNumber: string;
  POSID: number;
  USIN: string;
  DateTime: string;
  BuyerPNTN: string;
  BuyerCNIC: string;
  BuyerName: string;
  BuyerPhoneNumber: string;
  TotalBillAmount: number;
  TotalQuantity: number;
  TotalSaleValue: number;
  TotalTaxCharged: number;
  Discount: number;
  FurtherTax: number;
  PaymentMode: number;
  RefUSIN: string | null;
  InvoiceType: number;
  Items: PraItemPayload[];
}

export type PraOutcomeKind =
  | "success"
  | "already_exists"
  | "auth"
  | "ip"
  | "validation"
  | "rejected"
  | "unknown";

export interface PraPostResult {
  ok: boolean;
  fiscalNumber: string;
  code: string;
  message: string;
  nextAction: string;
  alreadyExists: boolean;
  kind: PraOutcomeKind;
  raw: string;
}

/** Ambiguous transport — do not treat as a PRA reject and do not post again until reconciled. */
export function unknownPraResult(message: string, raw = ""): PraPostResult {
  return {
    ok: false,
    fiscalNumber: "",
    code: "",
    message,
    nextAction:
      "Check IRIS → IMS Fiscal Report for this USIN. If it is there, enter the fiscal number. If not, mark not posted and retry once.",
    alreadyExists: false,
    kind: "unknown",
    raw,
  };
}

export function lineDiscountTotal(items: ReadonlyArray<InvoiceLine>): number {
  return money(items.reduce((sum, line) => sum + money(line.discount), 0));
}

export function invoiceTotalsAreFrozen(status: Invoice["status"]): boolean {
  return status === "posted" || status === "unknown";
}

export function recalcLine(line: InvoiceLine): InvoiceLine {
  const saleValue = money(line.saleValue);
  const discount = money(Math.min(Math.max(0, line.discount), Math.max(0, saleValue)));
  const taxable = money(saleValue - discount);
  const taxCharged = money(taxable * (line.taxRate / 100));
  const furtherTax = money(line.furtherTax);
  return {
    ...line,
    saleValue,
    discount,
    furtherTax,
    taxCharged,
    totalAmount: money(taxable + taxCharged + furtherTax),
  };
}

export function totalsFromItems(
  items: ReadonlyArray<InvoiceLine>,
  _headerDiscount?: number,
): Pick<
  Invoice,
  "totalQuantity" | "totalSaleValue" | "totalTaxCharged" | "furtherTax" | "totalBillAmount" | "discount"
> {
  const lines = items.map(recalcLine);
  const totalQuantity = money(lines.reduce((sum, line) => sum + line.quantity, 0));
  const totalSaleValue = money(lines.reduce((sum, line) => sum + line.saleValue, 0));
  const totalTaxCharged = money(lines.reduce((sum, line) => sum + line.taxCharged, 0));
  const furtherTax = money(lines.reduce((sum, line) => sum + line.furtherTax, 0));
  const discount = lineDiscountTotal(lines);
  return {
    totalQuantity,
    totalSaleValue,
    totalTaxCharged,
    furtherTax,
    discount,
    totalBillAmount: money(totalSaleValue + totalTaxCharged + furtherTax - discount),
  };
}

/** Posted / unknown invoices keep the numbers PRA already saw. Drafts recalculate. */
export function totalsForInvoice(
  invoice: Pick<
    Invoice,
    | "status"
    | "items"
    | "totalQuantity"
    | "totalSaleValue"
    | "totalTaxCharged"
    | "furtherTax"
    | "totalBillAmount"
    | "discount"
  >,
): Pick<
  Invoice,
  "totalQuantity" | "totalSaleValue" | "totalTaxCharged" | "furtherTax" | "totalBillAmount" | "discount"
> {
  if (invoiceTotalsAreFrozen(invoice.status)) {
    return {
      totalQuantity: invoice.totalQuantity,
      totalSaleValue: invoice.totalSaleValue,
      totalTaxCharged: invoice.totalTaxCharged,
      furtherTax: invoice.furtherTax,
      totalBillAmount: invoice.totalBillAmount,
      discount: invoice.discount,
    };
  }
  return totalsFromItems(invoice.items);
}

export function isRealFiscalNumber(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && !/^not available$/i.test(trimmed);
}

export function isPraSuccessCode(code: string): boolean {
  const normalized = code.trim();
  return PRA_SUCCESS_CODES.includes(normalized as (typeof PRA_SUCCESS_CODES)[number]);
}

export function isPraDuplicateText(value: string): boolean {
  const text = value.toLowerCase();
  return (
    /\busin\b[\s\S]{0,40}\balready exist/.test(text) ||
    /\balready exist[\s\S]{0,40}\busin\b/.test(text) ||
    /\bduplicate usin\b/.test(text) ||
    /\binvoice already exist/.test(text)
  );
}

export function buildPayload(client: Client, invoice: Invoice): PraInvoicePayload {
  const totals = totalsFromItems(invoice.items);
  const refUsin = invoice.refUsin.trim() || null;
  return {
    InvoiceNumber: "",
    POSID: Number(digitsOnly(client.posId)),
    USIN: invoice.usin.trim(),
    DateTime: invoice.dateTime.trim(),
    BuyerPNTN: invoice.buyerPntn.trim(),
    BuyerCNIC: digitsOnly(invoice.buyerCnic),
    BuyerName: invoice.buyerName.trim(),
    BuyerPhoneNumber: digitsOnly(invoice.buyerPhone),
    TotalBillAmount: totals.totalBillAmount,
    TotalQuantity: totals.totalQuantity,
    TotalSaleValue: totals.totalSaleValue,
    TotalTaxCharged: totals.totalTaxCharged,
    Discount: totals.discount,
    FurtherTax: totals.furtherTax,
    PaymentMode: invoice.paymentMode,
    RefUSIN: refUsin,
    InvoiceType: invoice.invoiceType,
    Items: invoice.items.map((item) => {
      const line = recalcLine(item);
      return {
        ItemCode: line.itemCode.trim(),
        ItemName: line.itemName.trim(),
        Quantity: line.quantity,
        PCTCode: line.pctCode.trim(),
        TaxRate: line.taxRate,
        SaleValue: line.saleValue,
        TotalAmount: line.totalAmount,
        TaxCharged: line.taxCharged,
        Discount: line.discount,
        FurtherTax: line.furtherTax,
        InvoiceType: invoice.invoiceType,
        RefUSIN: refUsin,
      };
    }),
  };
}

export function validateInvoice(client: Client, invoice: Invoice): string[] {
  const errors: string[] = [];
  if (!client.posId.trim()) errors.push("Client is missing POS ID.");
  if (!Number(digitsOnly(client.posId))) errors.push("POS ID must be numeric.");
  if (!client.posToken.trim()) errors.push("Client is missing eIMS token.");
  if (!invoice.usin.trim()) errors.push("USIN is required.");
  if (invoice.usin.trim().length > 50) errors.push("USIN must be 50 characters or fewer.");
  if (!invoice.dateTime.trim()) errors.push("Invoice date/time is required.");
  else if (!PRA_DATE_TIME.test(invoice.dateTime.trim())) {
    errors.push("Date time must be YYYY-MM-DD HH:MM:SS (milliseconds optional).");
  }
  if (![1, 2, 3].includes(invoice.invoiceType)) {
    errors.push("Invoice type must be 1 (New), 2 (Debit), or 3 (Credit).");
  }
  if (![1, 2, 3, 4, 5, 6].includes(invoice.paymentMode)) {
    errors.push("Payment mode must be 1–6 (Cash, Card, Gift voucher, Loyalty card, Mixed, Cheque).");
  }
  if (invoice.items.length === 0) errors.push("Add at least one line item.");
  if (invoice.invoiceType !== 1) {
    if (!invoice.refUsin.trim()) {
      errors.push("Debit/credit notes need the original USIN in Ref USIN.");
    } else if (invoice.refUsin.trim() === invoice.usin.trim()) {
      errors.push("Ref USIN must be the original posted USIN, not this note’s USIN.");
    }
  }
  if (invoice.refUsin.trim().length > 50) errors.push("Ref USIN must be 50 characters or fewer.");
  if (invoice.buyerName.trim().length > 150) errors.push("Buyer name must be 150 characters or fewer.");
  if (invoice.buyerCnic && digitsOnly(invoice.buyerCnic).length !== 13) {
    errors.push("Buyer CNIC must be 13 digits if provided.");
  }
  if (invoice.buyerPntn) {
    const pntn = invoice.buyerPntn.trim();
    if (!/^\d{7}-\d$/.test(pntn)) errors.push("Buyer PNTN should look like 1234567-8.");
    if (!invoice.buyerName.trim()) {
      errors.push("B2B invoices with a buyer PNTN also need the buyer name.");
    }
  }
  if (digitsOnly(invoice.buyerPhone).length > 20) {
    errors.push("Buyer phone must be 20 digits or fewer.");
  }
  if (invoice.discount < 0) errors.push("Header discount cannot be negative.");
  invoice.items.forEach((item, index) => {
    const n = index + 1;
    if (!item.itemName.trim()) errors.push(`Line ${n}: item name is required.`);
    if (item.itemName.trim().length > 150) errors.push(`Line ${n}: item name must be 150 characters or fewer.`);
    if (!item.itemCode.trim()) errors.push(`Line ${n}: item code is required.`);
    if (item.itemCode.trim().length > 50) errors.push(`Line ${n}: item code must be 50 characters or fewer.`);
    if (item.quantity <= 0) errors.push(`Line ${n}: quantity must be greater than 0.`);
    if (!/^\d{8}$/.test(item.pctCode.trim())) {
      errors.push(`Line ${n}: PCT/HS code must be 8 digits.`);
    }
    if (item.taxRate < 0 || item.taxRate > 100) {
      errors.push(`Line ${n}: tax rate must be between 0 and 100.`);
    }
    if (item.saleValue < 0) errors.push(`Line ${n}: sale value cannot be negative.`);
    if (item.discount < 0) errors.push(`Line ${n}: discount cannot be negative.`);
    if (item.discount > item.saleValue) {
      errors.push(`Line ${n}: discount cannot exceed sale value.`);
    }
    if (item.furtherTax < 0) errors.push(`Line ${n}: further tax cannot be negative.`);
  });
  const totals = totalsFromItems(invoice.items);
  if (money(invoice.discount) !== totals.discount) {
    errors.push("Header discount must equal the sum of line discounts.");
  }
  if (totals.totalBillAmount < 0) errors.push("Bill amount cannot be negative.");
  return errors;
}

export function postedMessage(fiscalNumber: string, environment: Client["environment"]): string {
  const usable = isRealFiscalNumber(fiscalNumber);
  if (usable) return `Posted. Fiscal number ${fiscalNumber}.`;
  if (environment === "sandbox") {
    return "Posted to sandbox. PRA did not issue a fiscal number for this POS ID (demo IDs often return Not Available).";
  }
  return "Posted. PRA accepted the invoice but did not return a fiscal number.";
}

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function readPraErrors(record: Record<string, unknown>): string {
  const errors = record.Errors ?? record.errors;
  if (!errors || errors === "null") return "";
  if (typeof errors === "string") return errors.trim();
  if (!Array.isArray(errors)) return "";
  return errors
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        return asText(row.Error ?? row.error ?? row.Message ?? row.message ?? row.Response);
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

/** Read InvoiceNumber from raw JSON so 18-digit fiscals are not rounded by JSON.parse. */
export function readJsonStringOrInt(raw: string, keys: readonly string[]): string {
  for (const key of keys) {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*(?:"([^"]*)"|(-?\\d+))`, "i"));
    if (match) return (match[1] ?? match[2] ?? "").trim();
  }
  return "";
}

export function parsePraBody(raw: string): { code: string; message: string; fiscalNumber: string } {
  const fiscalFromRaw = readJsonStringOrInt(raw, ["InvoiceNumber", "invoiceNumber"]);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { code: "", message: raw, fiscalNumber: fiscalFromRaw };
    }
    const record = parsed as Record<string, unknown>;
    const code = asText(record.Code ?? record.code);
    const errors = readPraErrors(record);
    const response = asText(record.Response ?? record.response ?? record.Message ?? record.message);
    const message = [response, errors].filter(Boolean).join(" ") || raw;
    const fiscalNumber = fiscalFromRaw || asText(record.InvoiceNumber ?? record.invoiceNumber);
    return { code, message, fiscalNumber };
  } catch {
    return { code: "", message: raw, fiscalNumber: fiscalFromRaw };
  }
}

export function mapPraOutcome(
  parsed: { code: string; message: string; fiscalNumber: string },
  httpStatus: number,
): Omit<PraPostResult, "raw"> {
  const code = parsed.code.trim();
  const message = parsed.message.trim();
  const fiscalNumber = parsed.fiscalNumber.trim();
  const blob = `${code} ${message} ${fiscalNumber}`.trim();
  const duplicate = isPraDuplicateText(blob);
  const successCode = isPraSuccessCode(code);
  const realFiscal = isRealFiscalNumber(fiscalNumber);

  if (successCode) {
    return {
      ok: true,
      fiscalNumber,
      code,
      message: message || "Posted",
      nextAction: "",
      alreadyExists: duplicate,
      kind: duplicate ? "already_exists" : "success",
    };
  }

  if (duplicate) {
    const nextAction = realFiscal ? uiStrings.praDuplicateWithFiscal : uiStrings.praDuplicateLookup;
    return {
      ok: false,
      fiscalNumber: realFiscal ? fiscalNumber : "",
      code,
      message: message || uiStrings.praAlreadyHasUsin,
      nextAction,
      alreadyExists: true,
      kind: "already_exists",
    };
  }

  const lower = blob.toLowerCase();
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    /unauthorized|invalid token|invalid authorization|bearer/.test(lower)
  ) {
    return {
      ok: false,
      fiscalNumber: "",
      code,
      message: message || (httpStatus ? `HTTP ${httpStatus}` : uiStrings.praRefusedToken),
      nextAction: uiStrings.praAuthNext,
      alreadyExists: false,
      kind: "auth",
    };
  }
  if (/whitelist|white list|not allowed|server ip/.test(lower)) {
    return {
      ok: false,
      fiscalNumber: "",
      code,
      message: message || uiStrings.praRefusedIp,
      nextAction: uiStrings.praIpNext,
      alreadyExists: false,
      kind: "ip",
    };
  }
  if (
    httpStatus === 400 ||
    /invalid invoice|validation|required field|invalid data|pct|datetime|usin is required/.test(lower)
  ) {
    return {
      ok: false,
      fiscalNumber: "",
      code,
      message: message || uiStrings.praRejectedPayload,
      nextAction: uiStrings.praValidationNext,
      alreadyExists: false,
      kind: "validation",
    };
  }

  return {
    ok: false,
    fiscalNumber: "",
    code,
    message: message || (httpStatus ? `HTTP ${httpStatus}` : "PRA rejected the invoice."),
    nextAction: uiStrings.praGenericNext,
    alreadyExists: false,
    kind: "rejected",
  };
}

export function interpretPraPost(
  raw: string,
  httpStatus: number,
  environment: Client["environment"],
): PraPostResult {
  const parsed = parsePraBody(raw);
  void environment;
  return { ...mapPraOutcome(parsed, httpStatus), raw };
}

export function failureText(result: Pick<PraPostResult, "message" | "nextAction">): string {
  return [result.message, result.nextAction].filter(Boolean).join(" ");
}

export const PRA_FETCH_MS = 45_000;

/** True when the body looks like PRA JSON, not Frappe/nginx HTML. */
export function isPraTransportBody(raw: string, contentType = ""): boolean {
  if (/html/i.test(contentType)) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return false;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

/** True when the proxy response is not a clear PRA JSON answer (timeout, gateway, HTML). */
export function isAmbiguousPraTransport(status: number, raw: string, contentType = ""): boolean {
  if (status === 0) return true;
  if (status === 404 || status === 502 || status === 503 || status === 504) return true;
  if (status >= 500) return true;
  return !isPraTransportBody(raw, contentType);
}

/** @deprecated use isAmbiguousPraTransport — never fall back to a remote PRA URL from the browser. */
export function shouldFallbackFromProxy(status: number, raw: string, contentType = ""): boolean {
  return isAmbiguousPraTransport(status, raw, contentType);
}

async function sendPra(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; raw: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRA_FETCH_MS);
  try {
    const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    const raw = await response.text();
    return {
      status: response.status,
      raw,
      contentType: response.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function postInvoice(
  client: Client,
  payload: PraInvoicePayload,
): Promise<PraPostResult> {
  const localPath =
    client.environment === "production"
      ? "/pra-ims/ims/production/api/Live/PostData"
      : "/pra-ims/ims/sandbox/api/Live/PostData";

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${client.posToken.trim()}`,
  };
  const body = JSON.stringify(payload);

  try {
    const first = await sendPra(localPath, headers, body);
    if (!isAmbiguousPraTransport(first.status, first.raw, first.contentType)) {
      return interpretPraPost(first.raw, first.status, client.environment);
    }
    return unknownPraResult(
      "No clear answer from PRA (proxy timeout or gateway error). Do not post this USIN again until you check IRIS.",
      first.raw,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return unknownPraResult(
      `${message}. Do not post this USIN again until you check IRIS → IMS Fiscal Report.`,
      message,
    );
  }
}
