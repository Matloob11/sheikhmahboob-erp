import type { Environment, InvoiceStatus, ReturnStatus } from "../types";

const INVOICE_STATUS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  validated: "Validated",
  posted: "Posted",
  failed: "Failed",
  unknown: "Unclear",
};

const RETURN_STATUS: Record<ReturnStatus, string> = {
  open: "Open",
  ready: "Ready",
  filed: "Filed",
};

const ENVIRONMENT: Record<Environment, string> = {
  sandbox: "Sandbox",
  production: "Production",
};

export function invoiceStatusLabel(status: InvoiceStatus, inFlight = false): string {
  const base = INVOICE_STATUS[status] ?? status;
  return inFlight ? `${base} · sending` : base;
}

export function returnStatusLabel(status: ReturnStatus): string {
  return RETURN_STATUS[status] ?? status;
}

export function environmentLabel(environment: Environment): string {
  return ENVIRONMENT[environment] ?? environment;
}
