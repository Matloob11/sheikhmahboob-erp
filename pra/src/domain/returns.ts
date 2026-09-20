import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { newId } from "../lib/ids";
import { money } from "../lib/money";
import { assertPeriodUnlocked } from "./periodLock";
import { logEvent } from "./events";
import { isCnic, validatePurchaseDraft } from "./validate";
import type { Purchase, ReturnPeriod, ReturnStatus } from "../types";

export type PurchaseDraft = {
  id?: string;
  clientId: string;
  period: string;
  supplierName: string;
  supplierPntn: string;
  invoiceNo: string;
  invoiceDate: string;
  saleValue: number;
  taxRate: number;
  blockedCredit?: boolean;
  notes?: string;
  supplierCnic?: string;
  pctCode?: string;
  district?: string;
  withheld?: number;
  reverseCharge?: boolean;
};

export function validatePurchaseExtras(input: Pick<PurchaseDraft, "supplierCnic">): string[] {
  if (input.supplierCnic?.trim() && !isCnic(input.supplierCnic)) {
    return ["Supplier CNIC must be 13 digits if provided."];
  }
  return [];
}

export async function savePurchase(input: PurchaseDraft): Promise<{ purchase?: Purchase; errors: string[] }> {
  const errors = [...validatePurchaseDraft(input), ...validatePurchaseExtras(input)];
  if (errors.length) return { errors };
  try {
    await assertPeriodUnlocked(input.clientId, input.period);
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : "Period is locked."] };
  }
  const taxCharged = money((input.saleValue * input.taxRate) / 100);
  const now = Date.now();
  const extras = {
    supplierName: input.supplierName.trim(),
    supplierPntn: input.supplierPntn.trim(),
    invoiceNo: input.invoiceNo.trim(),
    invoiceDate: input.invoiceDate,
    saleValue: input.saleValue,
    taxRate: input.taxRate,
    taxCharged,
    totalAmount: money(input.saleValue + taxCharged),
    notes: input.notes?.trim() ?? "",
    blockedCredit: input.blockedCredit === true,
    supplierCnic: input.supplierCnic?.trim() ?? "",
    pctCode: input.pctCode?.trim() ?? "",
    district: input.district?.trim() ?? "",
    withheld: input.withheld ?? 0,
    reverseCharge: input.reverseCharge === true,
    updatedAt: now,
  };
  if (input.id) {
    const prev = await db.purchases.get(input.id);
    if (!prev) return { errors: ["Purchase not found."] };
    const purchase: Purchase = {
      ...prev,
      ...extras,
      clientId: input.clientId,
      period: input.period,
      updatedAt: Math.max(now, (prev.updatedAt ?? 0) + 1),
    };
    await db.purchases.put(purchase);
    await logEvent({
      kind: "purchase.updated",
      clientId: input.clientId,
      title: `Annex A ${purchase.invoiceNo}`,
      detail: purchase.supplierName,
    });
    notifyDb();
    return { purchase, errors: [] };
  }
  const purchase: Purchase = {
    id: newId("pur"),
    clientId: input.clientId,
    period: input.period,
    createdAt: now,
    ...extras,
  };
  await db.purchases.add(purchase);
  await logEvent({
    kind: "purchase.added",
    clientId: input.clientId,
    title: `Annex A ${purchase.invoiceNo}`,
    detail: purchase.supplierName,
  });
  notifyDb();
  return { purchase, errors: [] };
}

export async function addPurchase(input: PurchaseDraft): Promise<{ purchase?: Purchase; errors: string[] }> {
  return savePurchase({ ...input, id: undefined });
}

export async function removePurchase(id: string): Promise<void> {
  const prev = await db.purchases.get(id);
  if (!prev) return;
  await assertPeriodUnlocked(prev.clientId, prev.period);
  await db.purchases.delete(id);
  await logEvent({
    kind: "purchase.removed",
    clientId: prev.clientId,
    title: `Removed Annex A ${prev.invoiceNo}`,
    detail: prev.supplierName,
  });
  notifyDb();
}

export function pickReturnForPeriod(
  rows: ReadonlyArray<ReturnPeriod>,
  clientId: string,
  period: string,
): ReturnPeriod | undefined {
  const matches = rows.filter((row) => row.clientId === clientId && row.period === period);
  if (matches.length === 0) return undefined;
  return matches.reduce((latest, row) => (row.updatedAt >= latest.updatedAt ? row : latest));
}

export async function findReturnForPeriod(
  clientId: string,
  period: string,
): Promise<ReturnPeriod | undefined> {
  const rows = await db.returns.where("[clientId+period]").equals([clientId, period]).toArray();
  return pickReturnForPeriod(rows, clientId, period);
}

export async function markReturn(input: {
  clientId: string;
  period: string;
  status: ReturnStatus;
  existing?: ReturnPeriod;
  notes?: string;
  irisAck?: string;
}): Promise<ReturnPeriod> {
  const now = Date.now();
  const existing = input.existing ?? (await findReturnForPeriod(input.clientId, input.period));
  const filedAt =
    input.status === "filed" ? (existing?.filedAt ?? now) : existing?.filedAt;
  const irisAck = input.irisAck ?? existing?.irisAck ?? "";
  const next: ReturnPeriod = existing
    ? {
        ...existing,
        status: input.status,
        notes: input.notes ?? existing.notes,
        filedAt,
        irisAck,
        updatedAt: now,
      }
    : {
        id: newId("ret"),
        clientId: input.clientId,
        period: input.period,
        status: input.status,
        notes: input.notes ?? "",
        filedAt,
        irisAck,
        createdAt: now,
        updatedAt: now,
      };
  await db.returns.put(next);
  if (input.status === "ready" || input.status === "filed") {
    await logEvent({
      kind: input.status === "ready" ? "return.ready" : "return.filed",
      clientId: input.clientId,
      title: `${input.period} marked ${input.status}`,
    });
  }
  notifyDb();
  return next;
}
