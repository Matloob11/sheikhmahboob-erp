import { calendarDaysUntil, dueInstants } from "../lib/ids";
import { type KeyValueStore, browserStore } from "./reminders";

export const DUE_NOTIFY_FIRED_KEY = "daftar-due-notify-fired";
export type DueKind = "payment" | "return";

export function dayStamp(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function dueNotifyKey(period: string, kind: DueKind, stamp: string): string {
  return `${period}:${kind}:${stamp}`;
}

export function dueNotifyCandidates(
  period: string,
  now = new Date(),
): Array<{ kind: DueKind; days: number }> {
  const dues = dueInstants(period);
  const rows: Array<{ kind: DueKind; days: number }> = [];
  const payment = calendarDaysUntil(dues.payment, now);
  const ret = calendarDaysUntil(dues.returnDue, now);
  if (payment <= 0) rows.push({ kind: "payment", days: payment });
  if (ret <= 0) rows.push({ kind: "return", days: ret });
  return rows;
}

function readFired(store: KeyValueStore | undefined): string[] {
  const raw = store?.getItem(DUE_NOTIFY_FIRED_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((row): row is string => typeof row === "string") : [];
  } catch {
    return [];
  }
}

export function markDueNotifyFired(
  period: string,
  now = new Date(),
  store: KeyValueStore | undefined = browserStore(),
): void {
  const stamp = dayStamp(now);
  const next = new Set(readFired(store));
  for (const row of dueNotifyCandidates(period, now)) {
    next.add(dueNotifyKey(period, row.kind, stamp));
  }
  store?.setItem(DUE_NOTIFY_FIRED_KEY, JSON.stringify([...next]));
}

export function shouldFireDueNotify(
  period: string,
  now = new Date(),
  store: KeyValueStore | undefined = browserStore(),
): boolean {
  const candidates = dueNotifyCandidates(period, now);
  if (!candidates.length) return false;
  const fired = new Set(readFired(store));
  const stamp = dayStamp(now);
  return candidates.some((row) => !fired.has(dueNotifyKey(period, row.kind, stamp)));
}

export async function requestDueNotifyPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  return Notification.requestPermission();
}

export function fireDueNotify(
  period: string,
  now = new Date(),
  store: KeyValueStore | undefined = browserStore(),
): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  if (!shouldFireDueNotify(period, now, store)) return false;
  for (const row of dueNotifyCandidates(period, now)) {
    const title = row.kind === "payment" ? "PRA payment date (15th)" : "PRA return date (18th)";
    const when =
      row.days === 0
        ? "Due today on this desk working paper."
        : `Overdue by ${Math.abs(row.days)} day(s) on this desk.`;
    new Notification(title, {
      body: `${when} Official 1Bill / return filing stay on IRIS.`,
    });
  }
  markDueNotifyFired(period, now, store);
  return true;
}
