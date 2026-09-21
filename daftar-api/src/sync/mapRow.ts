/**
 * Map Postgres snake_case rows → desk camelCase for /sync/pull.
 * POS tokens are always stripped — never returned to the browser.
 */

function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

const NUMERIC_KEYS = new Set([
  "invoice_type",
  "payment_mode",
  "attempt_count",
  "tax_rate",
  "discount",
  "further_tax",
  "total_quantity",
  "total_sale_value",
  "total_tax_charged",
  "total_bill_amount",
  "extra_tax",
  "st_withheld",
  "amount",
  "paid_amount",
  "withheld",
  "sale_value",
  "tax_charged",
  "total_amount",
  "default_qty",
  "quantity",
]);

function maybeNumber(key: string, value: unknown): unknown {
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value)) return value;
  if (key.endsWith("_at") || NUMERIC_KEYS.has(key)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}
function convertValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (key === "items" && typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
    return mapRow(value as Record<string, unknown>);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? mapRow(item as Record<string, unknown>)
        : item,
    );
  }
  return maybeNumber(key, value);
}

export function mapRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "pos_token") {
      out.posToken = "";
      continue;
    }
    out[snakeToCamelKey(key)] = convertValue(key, value);
  }
  return out;
}

export function mapRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(mapRow);
}
