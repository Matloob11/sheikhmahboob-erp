export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function pkr(value: number): string {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 2,
  }).format(money(value));
}

export function parseAmount(raw: string): number {
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? money(n) : 0;
}

/** Accept a keystroke into a draft amount field without collapsing "1." to "1". */
export function nextAmountDraft(previous: string, incoming: string): string {
  const cleaned = incoming.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "." || /^\d*\.?\d*$/.test(cleaned)) return incoming;
  return previous;
}

export function amountFromDraft(draft: string): number {
  const cleaned = draft.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === ".") return 0;
  return parseAmount(draft);
}

export function amountTextFromNumber(value: number): string {
  const n = money(value);
  if (Object.is(n, -0) || n === 0) return "0";
  return String(n);
}
