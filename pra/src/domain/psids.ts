import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { newId } from "../lib/ids";
import { logEvent } from "./events";
import { validatePsidDraft } from "./validate";
import type { PsidRecord, PsidStatus } from "../types";

export type PsidDraft = {
  id?: string;
  clientId: string;
  period: string;
  amount: number;
  head: string;
  psid: string;
  cpr: string;
  bank: string;
  paidOn: string;
  status: PsidStatus;
  notes: string;
  dueOn?: string;
  paidAmount?: number;
};

export function paidAmountFor(input: Pick<PsidDraft, "amount" | "status" | "paidAmount">): number {
  if (input.paidAmount != null) return input.paidAmount;
  if (input.status === "paid" || input.status === "claimed") return input.amount;
  return 0;
}

export async function savePsid(input: PsidDraft): Promise<{ record?: PsidRecord; errors: string[] }> {
  const errors = validatePsidDraft(input);
  if (errors.length) return { errors };
  const now = Date.now();
  const paidAmount = paidAmountFor(input);
  const dueOn = input.dueOn?.trim() ?? "";
  if (input.id) {
    const prev = await db.psids.get(input.id);
    if (!prev) return { errors: ["PSID row not found."] };
    const record: PsidRecord = {
      ...prev,
      clientId: input.clientId,
      period: input.period,
      amount: input.amount,
      head: input.head.trim() || "Punjab sales tax on services",
      psid: input.psid.trim(),
      cpr: input.cpr.trim(),
      bank: input.bank.trim(),
      paidOn: input.paidOn,
      status: input.status,
      notes: input.notes.trim(),
      dueOn,
      paidAmount,
      updatedAt: now,
    };
    await db.psids.put(record);
    await logEvent({
      kind: "psid.saved",
      clientId: input.clientId,
      title: record.psid ? `PSID ${record.psid}` : `${input.period} payment planned`,
      detail: record.status,
    });
    notifyDb();
    return { record, errors: [] };
  }
  const record: PsidRecord = {
    id: newId("psd"),
    clientId: input.clientId,
    period: input.period,
    amount: input.amount,
    head: input.head.trim() || "Punjab sales tax on services",
    psid: input.psid.trim(),
    cpr: input.cpr.trim(),
    bank: input.bank.trim(),
    paidOn: input.paidOn,
    status: input.status,
    notes: input.notes.trim(),
    dueOn,
    paidAmount,
    createdAt: now,
    updatedAt: now,
  };
  await db.psids.add(record);
  await logEvent({
    kind: "psid.saved",
    clientId: input.clientId,
    title: record.psid ? `PSID ${record.psid}` : `${input.period} payment planned`,
    detail: record.status,
  });
  notifyDb();
  return { record, errors: [] };
}

export async function removePsid(id: string): Promise<void> {
  const row = await db.psids.get(id);
  await db.psids.delete(id);
  if (row) {
    await logEvent({
      kind: "psid.removed",
      clientId: row.clientId,
      title: row.psid ? `Removed PSID ${row.psid}` : `Removed ${row.period} payment row`,
      detail: row.status,
    });
  }
  notifyDb();
}
