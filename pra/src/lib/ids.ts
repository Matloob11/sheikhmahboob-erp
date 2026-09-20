import { karachiStamp } from "./format";

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** Short ids from earlier builds (`inv_a1b2c3d4`) stay valid forever. */
export function isLegacyShortId(id: string): boolean {
  return /^[a-z]+_[0-9a-f]{8}$/i.test(id);
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function periodStamp(period: string, now = new Date()): Date {
  if (!/^\d{4}-\d{2}$/.test(period) || period === currentPeriod(now)) return now;
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  if (!year || !month) return now;
  const last = new Date(year, month, 0);
  last.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
  return last;
}

export function nextUsin(pntn: string, existing: ReadonlyArray<string>, stamp = new Date()): string {
  const when = karachiStamp(stamp);
  const y = when.year;
  const m = String(when.month).padStart(2, "0");
  const d = String(when.day).padStart(2, "0");
  const base = `DFT-${digitsOnly(pntn).slice(0, 7) || "0000000"}-${y}${m}${d}`;
  let seq = 1;
  for (const usin of existing) {
    if (!usin.startsWith(base)) continue;
    const part = usin.split("-")[3];
    const n = Number(part);
    if (Number.isFinite(n) && n >= seq) seq = n + 1;
  }
  return `${base}-${String(seq).padStart(3, "0")}`;
}

export function currentPeriod(now = new Date()): string {
  const when = karachiStamp(now);
  return `${when.year}-${String(when.month).padStart(2, "0")}`;
}

export function filingPeriod(now = new Date()): string {
  const when = karachiStamp(now);
  const month = when.month === 1 ? 12 : when.month - 1;
  const year = when.month === 1 ? when.year - 1 : when.year;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function periodLabel(period: string): string {
  const [year, month] = period.split("-");
  if (!year || !month) return period;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString("en-PK", { month: "long", year: "numeric" });
}

/**
 * Payment: 15th of the month after the tax period.
 * Return: 18th of the month after the tax period.
 *
 * Source checked 16 Sep 2026 — PRA Tax Calendar
 * https://reg.pra.punjab.gov.pk/ptms/TaxeCalander.aspx
 * lists Date of payment = 15th and Date of filing = 18th for hotels,
 * courier, consultancy and other listed services (telecom is 21st/21st
 * and is not modelled here).
 *
 * Punjab Sales Tax on Services Act 2012 s.2(17) defines a return
 * “due date” as the 15th; the Authority’s published calendar (and IRIS
 * practice) uses the 18th for filing. This desk follows the calendar.
 */
export function dueInstants(period: string): { payment: Date; returnDue: Date } {
  const [year, month] = period.split("-");
  const next = new Date(Number(year), Number(month), 1);
  return {
    payment: new Date(next.getFullYear(), next.getMonth(), 15),
    returnDue: new Date(next.getFullYear(), next.getMonth(), 18),
  };
}

export function formatLongDay(value: Date): string {
  return value.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function dueDates(period: string): { payment: string; returnDue: string } {
  const instants = dueInstants(period);
  return { payment: formatLongDay(instants.payment), returnDue: formatLongDay(instants.returnDue) };
}

export function calendarDaysUntil(target: Date, now = new Date()): number {
  const start = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const end = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((end - start) / 86_400_000);
}

export function invoicePeriod(dateTime: string): string {
  return dateTime.trim().slice(0, 7);
}

export function inPeriod(dateTime: string, period: string): boolean {
  return invoicePeriod(dateTime) === period;
}
