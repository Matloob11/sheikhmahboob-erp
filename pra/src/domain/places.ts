import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { newId } from "../lib/ids";
import { logEvent } from "./events";
import type { ClientPlace } from "../types";

export type PlaceDraft = Omit<ClientPlace, "id" | "clientId" | "createdAt" | "updatedAt">;

export function validatePlaceDraft(draft: Pick<PlaceDraft, "label">): string[] {
  return draft.label.trim() ? [] : ["Place label is required."];
}

async function syncPrimaryPlace(clientId: string, place: ClientPlace): Promise<void> {
  const client = await db.clients.get(clientId);
  if (!client) return;
  await db.clients.put({
    ...client,
    address: place.address,
    city: place.city,
    branchId: place.branchId,
    branchName: place.label,
    updatedAt: Date.now(),
  });
}

async function clearOtherPrimaries(clientId: string, keepId: string): Promise<void> {
  const rows = await db.clientPlaces.where("clientId").equals(clientId).toArray();
  const others = rows.filter((row) => row.id !== keepId && row.isPrimary);
  for (const row of others) {
    await db.clientPlaces.put({ ...row, isPrimary: false, updatedAt: Date.now() });
  }
}

export async function savePlace(
  clientId: string,
  draft: PlaceDraft,
  editingId?: string,
): Promise<{ place: ClientPlace; errors: string[] }> {
  const errors = validatePlaceDraft(draft);
  const now = Date.now();
  if (errors.length) {
    return { place: { ...draft, id: editingId ?? "", clientId, createdAt: 0, updatedAt: now }, errors };
  }
  const existing = await db.clientPlaces.where("clientId").equals(clientId).toArray();
  const isPrimary = draft.isPrimary || existing.length === 0;
  let place: ClientPlace;
  if (editingId) {
    const prev = await db.clientPlaces.get(editingId);
    if (!prev) {
      return {
        place: { ...draft, id: editingId, clientId, createdAt: 0, updatedAt: now },
        errors: ["Place not found."],
      };
    }
    place = { ...prev, ...draft, clientId, isPrimary, updatedAt: now };
    await db.clientPlaces.put(place);
  } else {
    place = {
      ...draft,
      id: newId("plc"),
      clientId,
      isPrimary,
      createdAt: now,
      updatedAt: now,
    };
    await db.clientPlaces.add(place);
  }
  if (place.isPrimary) {
    await clearOtherPrimaries(clientId, place.id);
    await syncPrimaryPlace(clientId, place);
  }
  await logEvent({ kind: "client.saved", clientId, title: `Updated place ${place.label}` });
  notifyDb();
  return { place, errors: [] };
}

export async function removePlace(id: string): Promise<void> {
  const row = await db.clientPlaces.get(id);
  await db.clientPlaces.delete(id);
  if (row) {
    await logEvent({ kind: "client.saved", clientId: row.clientId, title: `Removed place ${row.label}` });
  }
  notifyDb();
}
