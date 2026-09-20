import { inPeriod } from "../lib/ids";
import type { Invoice, InvoiceStatus } from "../types";

export interface InvoiceListFilter {
  clientId?: string;
  status?: InvoiceStatus | "all";
  scope?: "period" | "all";
  period?: string;
  query?: string;
  from?: string;
  to?: string;
  buyer?: string;
}

export type InvoiceListQuery = {
  status: InvoiceStatus | "all";
  scope: "period" | "all";
  query: string;
  from: string;
  to: string;
  buyer: string;
};

const LIST_STATUSES = new Set<InvoiceListQuery["status"]>([
  "all",
  "draft",
  "validated",
  "posted",
  "failed",
  "unknown",
]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const emptyInvoiceListQuery: InvoiceListQuery = {
  status: "all",
  scope: "period",
  query: "",
  from: "",
  to: "",
  buyer: "",
};

function isoDay(value: string): string {
  return ISO_DAY.test(value) ? value : "";
}

export function parseInvoiceListSearch(search: string): InvoiceListQuery {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const status = params.get("status") ?? "";
  const scope = params.get("scope") ?? "";
  return {
    status: LIST_STATUSES.has(status as InvoiceListQuery["status"])
      ? (status as InvoiceListQuery["status"])
      : "all",
    scope: scope === "all" ? "all" : "period",
    query: (params.get("q") ?? "").trim(),
    from: isoDay(params.get("from") ?? ""),
    to: isoDay(params.get("to") ?? ""),
    buyer: (params.get("buyer") ?? "").trim(),
  };
}

export function writeInvoiceListSearch(query: InvoiceListQuery): string {
  const params = new URLSearchParams();
  if (query.status !== "all") params.set("status", query.status);
  if (query.scope === "all") params.set("scope", "all");
  const needle = query.query.trim();
  if (needle) params.set("q", needle);
  if (isoDay(query.from)) params.set("from", query.from);
  if (isoDay(query.to)) params.set("to", query.to);
  const buyer = query.buyer.trim();
  if (buyer) params.set("buyer", buyer);
  return params.toString();
}

export function filterInvoiceList(
  invoices: ReadonlyArray<Invoice>,
  filter: InvoiceListFilter,
): Invoice[] {
  const needle = filter.query?.trim().toLowerCase() ?? "";
  const buyer = filter.buyer?.trim().toLowerCase() ?? "";
  return invoices.filter((invoice) => {
    if (filter.clientId && invoice.clientId !== filter.clientId) return false;
    if (filter.status && filter.status !== "all" && invoice.status !== filter.status) return false;
    if (filter.scope === "period" && filter.period && !inPeriod(invoice.dateTime, filter.period)) {
      return false;
    }
    const day = invoice.dateTime.trim().slice(0, 10);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
    if (buyer) {
      const name = invoice.buyerName.trim().toLowerCase();
      const pntn = invoice.buyerPntn.trim().toLowerCase();
      if (name !== buyer && pntn !== buyer) return false;
    }
    if (needle) {
      const hay = `${invoice.usin} ${invoice.fiscalNumber} ${invoice.buyerName} ${invoice.buyerPntn}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export function distinctInvoiceBuyers(
  invoices: ReadonlyArray<Invoice>,
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const row of invoices) {
    const pntn = row.buyerPntn.trim();
    const name = row.buyerName.trim();
    const value = pntn || name;
    if (!value) continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, name || pntn);
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
