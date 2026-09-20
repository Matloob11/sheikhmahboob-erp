import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { digitsOnly, newId } from "../lib/ids";
import { logEvent } from "./events";
import type { ClientPosDevice, Environment } from "../types";

export type PosDeviceDraft = Omit<ClientPosDevice, "id" | "clientId" | "createdAt" | "updatedAt">;

export function validatePosDeviceDraft(draft: Pick<PosDeviceDraft, "posId">): string[] {
  const errors: string[] = [];
  if (!draft.posId.trim()) errors.push("POS ID is required.");
  else if (!Number(digitsOnly(draft.posId))) errors.push("POS ID must be numeric.");
  return errors;
}

export async function activatePosDevice(id: string): Promise<{ errors: string[] }> {
  const device = await db.clientPosDevices.get(id);
  if (!device) return { errors: ["POS device not found."] };
  const client = await db.clients.get(device.clientId);
  if (!client) return { errors: ["Client file not found."] };
  await db.clients.put({
    ...client,
    posId: device.posId,
    environment: device.environment,
    updatedAt: Date.now(),
  });
  await logEvent({
    kind: "client.saved",
    clientId: device.clientId,
    title: `Active POS ${device.posId}`,
    detail: device.label,
  });
  notifyDb();
  return { errors: [] };
}

export async function savePosDevice(
  clientId: string,
  draft: PosDeviceDraft,
  editingId?: string,
): Promise<{ device: ClientPosDevice; errors: string[] }> {
  const errors = validatePosDeviceDraft(draft);
  const now = Date.now();
  if (errors.length) {
    return { device: { ...draft, id: editingId ?? "", clientId, createdAt: 0, updatedAt: now }, errors };
  }
  const existing = await db.clientPosDevices.where("clientId").equals(clientId).toArray();
  const activate = existing.length === 0;
  let device: ClientPosDevice;
  if (editingId) {
    const prev = await db.clientPosDevices.get(editingId);
    if (!prev) {
      return {
        device: { ...draft, id: editingId, clientId, createdAt: 0, updatedAt: now },
        errors: ["POS device not found."],
      };
    }
    device = {
      ...prev,
      ...draft,
      clientId,
      label: draft.label.trim() || draft.posId.trim(),
      updatedAt: now,
    };
    await db.clientPosDevices.put(device);
  } else {
    device = {
      ...draft,
      id: newId("pos"),
      clientId,
      label: draft.label.trim() || draft.posId.trim(),
      createdAt: now,
      updatedAt: now,
    };
    await db.clientPosDevices.add(device);
  }
  if (activate) await activatePosDevice(device.id);
  else {
    await logEvent({ kind: "client.saved", clientId, title: `Updated POS ${device.posId}` });
    notifyDb();
  }
  return { device, errors: [] };
}

export async function removePosDevice(id: string): Promise<void> {
  const row = await db.clientPosDevices.get(id);
  await db.clientPosDevices.delete(id);
  if (row) {
    await logEvent({ kind: "client.saved", clientId: row.clientId, title: `Removed POS ${row.posId}` });
  }
  notifyDb();
}

export function emptyPosDraft(environment: Environment = "sandbox"): PosDeviceDraft {
  return { posId: "", label: "", environment };
}
