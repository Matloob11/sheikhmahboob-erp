import { periodLabel } from "../lib/ids";
import { uiStrings } from "../lib/uiStrings";
import { logEvent } from "./events";
import { notifyDb } from "../hooks/useLive";
import type { ReturnPeriod } from "../types";
import { db } from "../db";

export function periodOfInvoiceDate(dateTime: string): string {
  return dateTime.trim().slice(0, 7);
}

async function returnForPeriod(clientId: string, period: string): Promise<ReturnPeriod | undefined> {
  const rows = await db.returns.where("[clientId+period]").equals([clientId, period]).toArray();
  if (rows.length === 0) {
    const all = await db.returns.where("clientId").equals(clientId).toArray();
    return all.find((row) => row.period === period);
  }
  return rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
}

export async function isPeriodLocked(clientId: string, period: string): Promise<boolean> {
  const row = await returnForPeriod(clientId, period);
  return row?.status === "filed";
}

export async function assertPeriodUnlocked(clientId: string, dateTimeOrPeriod: string): Promise<void> {
  const trimmed = dateTimeOrPeriod.trim();
  const period = /^\d{4}-\d{2}$/.test(trimmed) ? trimmed : periodOfInvoiceDate(trimmed);
  if (await isPeriodLocked(clientId, period)) {
    throw new Error(uiStrings.periodLocked(periodLabel(period)));
  }
}

export async function unlockPeriod(clientId: string, period: string): Promise<void> {
  const row = await returnForPeriod(clientId, period);
  if (!row || row.status !== "filed") {
    throw new Error("That period is not locked.");
  }
  const now = Date.now();
  const next: ReturnPeriod = {
    ...row,
    status: "ready",
    updatedAt: now,
  };
  await db.returns.put(next);
  await logEvent({
    kind: "return.unlocked",
    clientId,
    title: `Unlocked ${periodLabel(period)}`,
    detail: "Return moved back to ready so papers can change again.",
  });
  notifyDb();
}
