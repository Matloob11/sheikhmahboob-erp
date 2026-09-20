import { invoiceAmountSign, postedSalesInPeriod, signedInvoiceAmount, type FileLedger } from "./ledger";
import { inPeriod } from "../lib/ids";
import { money } from "../lib/money";
import type { Invoice, InvoiceStatus, PsidRecord } from "../types";

export interface SalesBookRow {
  usin: string;
  dateTime: string;
  buyer: string;
  type: Invoice["invoiceType"];
  status: InvoiceStatus;
  sale: number;
  tax: number;
  bill: number;
  fiscal: string;
  lastCode: string;
}

export interface TaxByPctRow {
  pctCode: string;
  quantity: number;
  sale: number;
  tax: number;
  furtherTax: number;
}

export interface BuyerLedgerRow {
  key: string;
  buyer: string;
  count: number;
  sale: number;
  tax: number;
}

export interface PeriodDelta {
  saleValue: number;
  outputTax: number;
  inputTax: number;
  netPayable: number;
  psidGap: number;
  saleCount: number;
}

export function previousPeriod(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return period;
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const prior = new Date(year, month - 2, 1);
  return `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, "0")}`;
}

export function periodInvoices(
  invoices: ReadonlyArray<Invoice>,
  clientId: string,
  period: string,
): Invoice[] {
  return invoices.filter((row) => row.clientId === clientId && inPeriod(row.dateTime, period));
}

export function salesBook(
  invoices: ReadonlyArray<Invoice>,
  clientId: string,
  period: string,
): SalesBookRow[] {
  return periodInvoices(invoices, clientId, period)
    .slice()
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime) || a.usin.localeCompare(b.usin))
    .map((row) => ({
      usin: row.usin,
      dateTime: row.dateTime,
      buyer: row.buyerName.trim() || row.buyerPntn.trim() || "walk-in",
      type: row.invoiceType,
      status: row.status,
      sale: signedInvoiceAmount(row, row.totalSaleValue),
      tax: signedInvoiceAmount(row, row.totalTaxCharged),
      bill: signedInvoiceAmount(row, row.totalBillAmount),
      fiscal: row.fiscalNumber,
      lastCode: row.lastCode,
    }));
}

export function taxByPct(
  invoices: ReadonlyArray<Invoice>,
  clientId: string,
  period: string,
): TaxByPctRow[] {
  const groups = new Map<string, TaxByPctRow>();
  for (const invoice of postedSalesInPeriod(invoices, clientId, period)) {
    const sign = invoiceAmountSign(invoice);
    for (const line of invoice.items) {
      const current = groups.get(line.pctCode) ?? {
        pctCode: line.pctCode,
        quantity: 0,
        sale: 0,
        tax: 0,
        furtherTax: 0,
      };
      current.quantity += line.quantity * sign;
      current.sale += line.saleValue * sign;
      current.tax += line.taxCharged * sign;
      current.furtherTax += line.furtherTax * sign;
      groups.set(line.pctCode, current);
    }
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      quantity: money(row.quantity),
      sale: money(row.sale),
      tax: money(row.tax),
      furtherTax: money(row.furtherTax),
    }))
    .sort((a, b) => a.pctCode.localeCompare(b.pctCode));
}

export function buyerLedger(
  invoices: ReadonlyArray<Invoice>,
  clientId: string,
  period: string,
): BuyerLedgerRow[] {
  const groups = new Map<string, BuyerLedgerRow>();
  for (const invoice of postedSalesInPeriod(invoices, clientId, period)) {
    const pntn = invoice.buyerPntn.trim();
    const name = invoice.buyerName.trim();
    const key = pntn || name || "walk-in";
    const current = groups.get(key.toLowerCase()) ?? {
      key,
      buyer: name || pntn || "walk-in",
      count: 0,
      sale: 0,
      tax: 0,
    };
    current.count += 1;
    current.sale += signedInvoiceAmount(invoice, invoice.totalSaleValue);
    current.tax += signedInvoiceAmount(invoice, invoice.totalTaxCharged);
    groups.set(key.toLowerCase(), current);
  }
  return [...groups.values()]
    .map((row) => ({ ...row, sale: money(row.sale), tax: money(row.tax) }))
    .sort((a, b) => a.buyer.localeCompare(b.buyer));
}

export function failedPosts(
  invoices: ReadonlyArray<Invoice>,
  clientId: string,
  period: string,
): Invoice[] {
  return periodInvoices(invoices, clientId, period)
    .filter((row) => row.status === "failed")
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function psidGapRows(
  ledger: FileLedger,
  psids: ReadonlyArray<PsidRecord> = ledger.psids,
): { unpaid: PsidRecord[]; gap: number; paid: number } {
  const unpaid = psids.filter((row) => row.status !== "paid" && row.status !== "claimed");
  return { unpaid, gap: ledger.psidGap, paid: ledger.psidPaid };
}

export function periodCompare(current: FileLedger, previous: FileLedger): PeriodDelta {
  return {
    saleValue: money(current.saleValue - previous.saleValue),
    outputTax: money(current.outputTax - previous.outputTax),
    inputTax: money(current.inputTax - previous.inputTax),
    netPayable: money(current.netPayable - previous.netPayable),
    psidGap: money(current.psidGap - previous.psidGap),
    saleCount: current.saleCount - previous.saleCount,
  };
}

export function dailyPostedBills(
  invoices: ReadonlyArray<Invoice>,
  clientId: string,
  period: string,
): number[] {
  const days = new Map<string, number>();
  for (const invoice of postedSalesInPeriod(invoices, clientId, period)) {
    const day = invoice.dateTime.trim().slice(0, 10);
    days.set(day, money((days.get(day) ?? 0) + signedInvoiceAmount(invoice, invoice.totalBillAmount)));
  }
  return [...days.keys()].sort().map((day) => days.get(day) ?? 0);
}
