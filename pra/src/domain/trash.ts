import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import type { Buyer, Invoice } from "../types";

const KEY = "daftar-trash-last";

export type TrashKind = "invoice" | "buyer" | "client";

export interface TrashRecord {
  kind: TrashKind;
  label: string;
  at: number;
  restore: unknown;
}

export function peekTrash(): TrashRecord | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const row = JSON.parse(raw) as TrashRecord;
    if (!row?.kind || Date.now() - row.at > 30 * 60_000) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return row;
  } catch {
    return null;
  }
}

export function stashTrash(row: Omit<TrashRecord, "at">): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...row, at: Date.now() }));
  } catch {
    /* private mode */
  }
}

export function clearTrash(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

export async function restoreTrash(): Promise<string | null> {
  const row = peekTrash();
  if (!row) return null;
  if (row.kind === "invoice") await db.invoices.put(row.restore as Invoice);
  else if (row.kind === "buyer") await db.buyers.put(row.restore as Buyer);
  else return null;
  clearTrash();
  notifyDb();
  return row.label;
}
