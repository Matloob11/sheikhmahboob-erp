/** Map validateInvoice messages to control ids / line focus targets. */
export function fieldKeyFromError(message: string): string | null {
  const line = /^Line (\d+):\s*(.+)$/i.exec(message);
  if (line) {
    const n = Number(line[1]);
    const body = (line[2] ?? "").toLowerCase();
    let col = "itemCode";
    if (body.includes("item name")) col = "itemName";
    else if (body.includes("quantity")) col = "quantity";
    else if (body.includes("pct") || body.includes("hs")) col = "pctCode";
    else if (body.includes("tax rate")) col = "taxRate";
    else if (body.includes("sale value")) col = "saleValue";
    else if (body.includes("discount")) col = "discount";
    else if (body.includes("further tax")) col = "furtherTax";
    else if (body.includes("item code")) col = "itemCode";
    return `line-${n}-${col}`;
  }
  const lower = message.toLowerCase();
  if (lower.includes("usin") && !lower.includes("ref")) return "usin";
  if (lower.includes("date")) return "invoice-date";
  if (lower.includes("invoice type")) return "invoice-type";
  if (lower.includes("payment")) return "payment-mode";
  if (lower.includes("ref usin")) return "ref-usin";
  if (lower.includes("buyer name")) return "buyer-name";
  if (lower.includes("buyer pntn") || lower.includes("pntn")) return "buyer-pntn";
  if (lower.includes("buyer cnic") || lower.includes("cnic")) return "buyer-cnic";
  if (lower.includes("buyer phone") || lower.includes("phone")) return "buyer-phone";
  if (lower.includes("header discount") || lower.includes("line discounts")) return "header-discount";
  if (lower.includes("at least one line")) return "invoice-lines";
  return null;
}

export function focusFirstFieldError(messages: ReadonlyArray<string>): void {
  for (const message of messages) {
    const key = fieldKeyFromError(message);
    if (!key) continue;
    if (key.startsWith("line-")) {
      const match = /^line-(\d+)-(.+)$/.exec(key);
      if (!match) continue;
      const row = Number(match[1]) - 1;
      const col = match[2];
      const el = document.querySelector<HTMLElement>(
        `[data-line-row="${row}"][data-line-col="${col}"]`,
      );
      if (el) {
        el.focus();
        return;
      }
    } else {
      const el = document.getElementById(key);
      if (el) {
        el.focus();
        return;
      }
    }
  }
  const banner = document.querySelector<HTMLElement>("[data-invoice-errors]");
  banner?.focus();
}

export function errorForField(messages: ReadonlyArray<string>, fieldKey: string): string | undefined {
  for (const message of messages) {
    if (fieldKeyFromError(message) === fieldKey) return message;
  }
  return undefined;
}
