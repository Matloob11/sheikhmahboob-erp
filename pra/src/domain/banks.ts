import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { newId } from "../lib/ids";
import { logEvent } from "./events";
import type { ClientBank } from "../types";

export type BankDraft = Omit<ClientBank, "id" | "clientId" | "createdAt" | "updatedAt">;

export function validateBankDraft(draft: Pick<BankDraft, "bankName">): string[] {
  return draft.bankName.trim() ? [] : ["Bank name is required."];
}

async function clearOtherPrimaries(clientId: string, keepId: string): Promise<void> {
  const rows = await db.clientBanks.where("clientId").equals(clientId).toArray();
  const others = rows.filter((row) => row.id !== keepId && row.isPrimary);
  for (const row of others) {
    await db.clientBanks.put({ ...row, isPrimary: false, updatedAt: Date.now() });
  }
}

export async function saveBank(
  clientId: string,
  draft: BankDraft,
  editingId?: string,
): Promise<{ bank: ClientBank; errors: string[] }> {
  const errors = validateBankDraft(draft);
  const now = Date.now();
  if (errors.length) {
    return { bank: { ...draft, id: editingId ?? "", clientId, createdAt: 0, updatedAt: now }, errors };
  }
  const existing = await db.clientBanks.where("clientId").equals(clientId).toArray();
  const isPrimary = draft.isPrimary || existing.length === 0;
  let bank: ClientBank;
  if (editingId) {
    const prev = await db.clientBanks.get(editingId);
    if (!prev) {
      return {
        bank: { ...draft, id: editingId, clientId, createdAt: 0, updatedAt: now },
        errors: ["Bank not found."],
      };
    }
    bank = { ...prev, ...draft, clientId, isPrimary, updatedAt: now };
    await db.clientBanks.put(bank);
  } else {
    bank = { ...draft, id: newId("bnk"), clientId, isPrimary, createdAt: now, updatedAt: now };
    await db.clientBanks.add(bank);
  }
  if (bank.isPrimary) await clearOtherPrimaries(clientId, bank.id);
  await logEvent({ kind: "client.saved", clientId, title: `Updated bank ${bank.bankName}` });
  notifyDb();
  return { bank, errors: [] };
}

export async function removeBank(id: string): Promise<void> {
  const row = await db.clientBanks.get(id);
  await db.clientBanks.delete(id);
  if (row) {
    await logEvent({ kind: "client.saved", clientId: row.clientId, title: `Removed bank ${row.bankName}` });
  }
  notifyDb();
}
