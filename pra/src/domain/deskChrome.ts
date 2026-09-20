export const INVOICE_STEPS = ["header", "lines", "review", "post"] as const;

export type InvoiceStep = (typeof INVOICE_STEPS)[number];

export const INVOICE_EDITOR_ADVANCED = [
  "extraTax",
  "stWithheld",
  "reverseCharge",
  "headerDiscount",
  "refUsin",
  "taxpayerType",
  "saleType",
  "buyerDistrict",
] as const;

export function hasExtraInvoiceFilters(filter: {
  query?: string;
  from?: string;
  to?: string;
  buyer?: string;
}): boolean {
  return Boolean(filter.query?.trim() || filter.from || filter.to || filter.buyer);
}

export function shouldShowInvoiceExtraFilters(userOpen: boolean, extraActive: boolean): boolean {
  return userOpen || extraActive;
}

export function shouldShowInvoiceBulkBar(listed: number, selected: number): boolean {
  return listed > 0 || selected > 0;
}

export function nextInvoiceStep(step: InvoiceStep): InvoiceStep {
  const index = INVOICE_STEPS.indexOf(step);
  return INVOICE_STEPS[Math.min(index + 1, INVOICE_STEPS.length - 1)] ?? step;
}

export function prevInvoiceStep(step: InvoiceStep): InvoiceStep {
  const index = INVOICE_STEPS.indexOf(step);
  return INVOICE_STEPS[Math.max(index - 1, 0)] ?? step;
}

export function invoiceEditorAdvanced(): readonly string[] {
  return INVOICE_EDITOR_ADVANCED;
}

export function shouldWarnLeave(dirty: boolean): boolean {
  return dirty;
}
