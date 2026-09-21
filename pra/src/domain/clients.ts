import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { newId } from "../lib/ids";
import { uiStrings } from "../lib/uiStrings";
import { logEvent } from "./events";
import { patchSettings } from "./settings";
import { hasRegistrationNo, isCnic, validateClient } from "./validate";
import type { Client, Environment } from "../types";

export type ClientDraft = Omit<Client, "id" | "createdAt" | "updatedAt">;

export const emptyClientDraft: ClientDraft = {
  businessName: "",
  brandName: "",
  pntn: "",
  cnic: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  sector: "Consultancy",
  branchName: "Head office",
  posId: "",
  posToken: "",
  environment: "sandbox" as Environment,
  postingMode: "browser",
  notes: "",
  ntn: "",
  personName: "",
  personType: "",
  businessId: "",
  branchId: "",
  stStatus: "",
  registeredOn: "",
  archived: false,
  cnicAsRegistration: false,
};

export function hasClientRegistration(
  client: Pick<Client, "pntn" | "cnic" | "cnicAsRegistration">,
): boolean {
  return hasRegistrationNo(client);
}

export function registrationDisplay(
  client: Pick<Client, "pntn" | "cnic" | "cnicAsRegistration">,
): string {
  if (client.pntn.trim()) return client.pntn.trim();
  if (client.cnicAsRegistration && isCnic(client.cnic)) return client.cnic.trim();
  return "";
}

export async function saveClient(draft: ClientDraft, editingId?: string): Promise<{ client: Client; errors: string[] }> {
  const errors = validateClient(draft);
  if (errors.length) return { client: { ...draft, id: editingId ?? "", createdAt: 0, updatedAt: 0 }, errors };
  const now = Date.now();
  if (editingId) {
    const prev = await db.clients.get(editingId);
    if (!prev) return { client: { ...draft, id: editingId, createdAt: 0, updatedAt: now }, errors: ["Client file not found."] };
    const client: Client = { ...prev, ...draft, updatedAt: now };
    await db.clients.put(client);
    await logEvent({ kind: "client.saved", clientId: client.id, title: `Updated ${client.businessName}` });
    notifyDb();
    return { client, errors: [] };
  }
  const client: Client = { ...draft, id: newId("cli"), createdAt: now, updatedAt: now };
  await db.clients.add(client);
  await patchSettings({ selectedClientId: client.id });
  await logEvent({ kind: "client.saved", clientId: client.id, title: `Opened file for ${client.businessName}` });
  return { client, errors: [] };
}

export async function clientFileCounts(id: string): Promise<{ invoices: number; purchases: number; psids: number }> {
  const [invoices, purchases, psids] = await Promise.all([
    db.invoices.where("clientId").equals(id).count(),
    db.purchases.where("clientId").equals(id).count(),
    db.psids.where("clientId").equals(id).count(),
  ]);
  return { invoices, purchases, psids };
}

export const CLIENT_CASCADE_STORES = [
  "invoices",
  "purchases",
  "returns",
  "psids",
  "buyers",
  "items",
  "events",
  "clientPlaces",
  "clientBanks",
  "clientPosDevices",
] as const;

export async function removeClientFile(id: string, cascade: boolean): Promise<void> {
  const client = await db.clients.get(id);
  if (cascade) {
    const invoices = await db.invoices.where("clientId").equals(id).toArray();
    const protectedRow = invoices.find((row) => row.status === "posted" || row.status === "unknown");
    if (protectedRow) {
      throw new Error(uiStrings.clientCascadeBlocked);
    }
    const [purchases, returns, psids, buyers, items, events, places, banks, devices] = await Promise.all([
      db.purchases.where("clientId").equals(id).toArray(),
      db.returns.where("clientId").equals(id).toArray(),
      db.psids.where("clientId").equals(id).toArray(),
      db.buyers.where("clientId").equals(id).toArray(),
      db.items.where("clientId").equals(id).toArray(),
      db.events.where("clientId").equals(id).toArray(),
      db.clientPlaces.where("clientId").equals(id).toArray(),
      db.clientBanks.where("clientId").equals(id).toArray(),
      db.clientPosDevices.where("clientId").equals(id).toArray(),
    ]);
    await db.transaction(
      "rw",
      [
        db.clients,
        db.invoices,
        db.purchases,
        db.returns,
        db.psids,
        db.buyers,
        db.items,
        db.events,
        db.clientPlaces,
        db.clientBanks,
        db.clientPosDevices,
      ],
      async () => {
        await db.clients.delete(id);
        await db.invoices.bulkDelete(invoices.map((row) => row.id));
        await db.purchases.bulkDelete(purchases.map((row) => row.id));
        await db.returns.bulkDelete(returns.map((row) => row.id));
        await db.psids.bulkDelete(psids.map((row) => row.id));
        await db.buyers.bulkDelete(buyers.map((row) => row.id));
        await db.items.bulkDelete(items.map((row) => row.id));
        await db.events.bulkDelete(events.map((row) => row.id));
        await db.clientPlaces.bulkDelete(places.map((row) => row.id));
        await db.clientBanks.bulkDelete(banks.map((row) => row.id));
        await db.clientPosDevices.bulkDelete(devices.map((row) => row.id));
      },
    );
  } else {
    await db.clients.delete(id);
  }
  await logEvent({
    kind: "client.removed",
    title: client ? `Removed ${client.businessName}` : "Removed a client file",
    detail: cascade ? "File and related papers deleted." : "File removed. Related papers left on the desk.",
  });
  notifyDb();
}

export async function mergeClientFiles(
  sourceId: string,
  targetId: string,
): Promise<{ errors: string[] }> {
  if (sourceId === targetId) return { errors: ["Pick two different client files."] };
  const source = await db.clients.get(sourceId);
  const target = await db.clients.get(targetId);
  if (!source || !target) return { errors: ["Client file not found."] };
  const [srcInvoices, tgtInvoices] = await Promise.all([
    db.invoices.where("clientId").equals(sourceId).toArray(),
    db.invoices.where("clientId").equals(targetId).toArray(),
  ]);
  const taken = new Set(tgtInvoices.map((row) => row.usin));
  const clash = srcInvoices.find((row) => taken.has(row.usin));
  if (clash) return { errors: [`USIN ${clash.usin} exists on both files. Rename one first.`] };

  const [purchases, returns, psids, buyers, items, events, places, banks, devices] = await Promise.all([
    db.purchases.where("clientId").equals(sourceId).toArray(),
    db.returns.where("clientId").equals(sourceId).toArray(),
    db.psids.where("clientId").equals(sourceId).toArray(),
    db.buyers.where("clientId").equals(sourceId).toArray(),
    db.items.where("clientId").equals(sourceId).toArray(),
    db.events.where("clientId").equals(sourceId).toArray(),
    db.clientPlaces.where("clientId").equals(sourceId).toArray(),
    db.clientBanks.where("clientId").equals(sourceId).toArray(),
    db.clientPosDevices.where("clientId").equals(sourceId).toArray(),
  ]);

  await db.transaction(
    "rw",
    [
      db.clients,
      db.invoices,
      db.purchases,
      db.returns,
      db.psids,
      db.buyers,
      db.items,
      db.events,
      db.clientPlaces,
      db.clientBanks,
      db.clientPosDevices,
    ],
    async () => {
      for (const row of srcInvoices) await db.invoices.put({ ...row, clientId: targetId });
      for (const row of purchases) await db.purchases.put({ ...row, clientId: targetId });
      for (const row of psids) await db.psids.put({ ...row, clientId: targetId });
      for (const row of buyers) await db.buyers.put({ ...row, clientId: targetId });
      for (const row of items) await db.items.put({ ...row, clientId: targetId });
      for (const row of events) await db.events.put({ ...row, clientId: targetId });
      for (const row of places) await db.clientPlaces.put({ ...row, clientId: targetId });
      for (const row of banks) await db.clientBanks.put({ ...row, clientId: targetId });
      for (const row of devices) await db.clientPosDevices.put({ ...row, clientId: targetId });
      for (const row of returns) {
        const existing = await db.returns.where("[clientId+period]").equals([targetId, row.period]).first();
        if (existing) await db.returns.delete(row.id);
        else await db.returns.put({ ...row, clientId: targetId });
      }
      await db.clients.delete(sourceId);
    },
  );
  await logEvent({
    kind: "client.removed",
    clientId: targetId,
    title: `Merged ${source.businessName} into ${target.businessName}`,
    detail: sourceId,
  });
  notifyDb();
  return { errors: [] };
}
