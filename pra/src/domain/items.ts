import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { newId } from "../lib/ids";
import { logEvent } from "./events";
import { defaultCatalogItemFromSector, validateItemDraft, validatePctDraft } from "./catalog";
import type { CatalogItem, PctCode } from "../types";

export type ItemDraft = Omit<CatalogItem, "id" | "clientId" | "createdAt" | "updatedAt">;
export type PctDraft = Pick<PctCode, "pctCode" | "name" | "taxRate">;

export async function saveCatalogItem(
  clientId: string,
  draft: ItemDraft,
  editingId?: string,
): Promise<{ item: CatalogItem; errors: string[] }> {
  const errors = validateItemDraft(draft);
  const now = Date.now();
  if (errors.length) {
    return {
      item: { ...draft, id: editingId ?? "", clientId, createdAt: 0, updatedAt: now },
      errors,
    };
  }
  if (editingId) {
    const prev = await db.items.get(editingId);
    if (!prev) {
      return {
        item: { ...draft, id: editingId, clientId, createdAt: 0, updatedAt: now },
        errors: ["Item not found."],
      };
    }
    const item: CatalogItem = { ...prev, ...draft, clientId, updatedAt: now };
    await db.items.put(item);
    await logEvent({ kind: "item.saved", clientId, title: `Updated item ${item.itemName}` });
    notifyDb();
    return { item, errors: [] };
  }
  const item: CatalogItem = { ...draft, id: newId("itm"), clientId, createdAt: now, updatedAt: now };
  await db.items.add(item);
  await logEvent({ kind: "item.saved", clientId, title: `Saved item ${item.itemName}` });
  notifyDb();
  return { item, errors: [] };
}

export async function addSectorDefaultItem(
  clientId: string,
  sector: string,
): Promise<{ item: CatalogItem; errors: string[] }> {
  const draft = defaultCatalogItemFromSector(sector);
  const rows = await db.items.where("clientId").equals(clientId).toArray();
  const existing = rows.find((row) => row.itemCode === draft.itemCode);
  if (existing) return { item: existing, errors: [] };
  return saveCatalogItem(clientId, {
    itemCode: draft.itemCode,
    itemName: draft.itemName,
    pctCode: draft.pctCode,
    taxRate: draft.taxRate,
    unit: draft.unit,
    defaultQty: draft.defaultQty,
    inactive: draft.inactive,
  });
}

export async function removeCatalogItem(id: string): Promise<void> {
  const row = await db.items.get(id);
  await db.items.delete(id);
  await logEvent({
    kind: "item.removed",
    clientId: row?.clientId,
    title: row ? `Removed item ${row.itemName}` : "Removed an item",
  });
  notifyDb();
}

export async function savePctCode(
  draft: PctDraft,
  editingId?: string,
): Promise<{ rate: PctCode; errors: string[] }> {
  const errors = validatePctDraft(draft);
  const now = Date.now();
  if (errors.length) {
    return {
      rate: {
        ...draft,
        id: editingId ?? "",
        seeded: false,
        createdAt: 0,
        updatedAt: now,
      },
      errors,
    };
  }
  const sameCode = (await db.pctCodes.where("pctCode").equals(draft.pctCode.trim()).toArray()).filter(
    (row) => row.id !== editingId,
  );
  if (sameCode.length) {
    return {
      rate: {
        ...draft,
        id: editingId ?? "",
        seeded: false,
        createdAt: 0,
        updatedAt: now,
      },
      errors: ["That PCT/HS code is already on the desk."],
    };
  }
  if (editingId) {
    const prev = await db.pctCodes.get(editingId);
    if (!prev) {
      return {
        rate: { ...draft, id: editingId, seeded: false, createdAt: 0, updatedAt: now },
        errors: ["PCT code not found."],
      };
    }
    const rate: PctCode = { ...prev, ...draft, pctCode: draft.pctCode.trim(), updatedAt: now };
    await db.pctCodes.put(rate);
    await logEvent({ kind: "pct.saved", title: `Updated PCT ${rate.pctCode}` });
    notifyDb();
    return { rate, errors: [] };
  }
  const rate: PctCode = {
    ...draft,
    id: newId("pct"),
    pctCode: draft.pctCode.trim(),
    seeded: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.pctCodes.add(rate);
  await logEvent({ kind: "pct.saved", title: `Saved PCT ${rate.pctCode}` });
  notifyDb();
  return { rate, errors: [] };
}

export async function removePctCode(id: string): Promise<{ errors: string[] }> {
  const row = await db.pctCodes.get(id);
  if (!row) return { errors: ["PCT code not found."] };
  if (row.seeded) return { errors: ["Seeded Punjab rates can be edited, not removed."] };
  await db.pctCodes.delete(id);
  await logEvent({ kind: "pct.removed", title: `Removed PCT ${row.pctCode}` });
  notifyDb();
  return { errors: [] };
}
