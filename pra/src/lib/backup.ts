import { db } from "../db";
import { logEvent } from "../domain/events";
import { formatDay } from "./format";
import { currentPeriod } from "./ids";
import type {
  Buyer,
  CatalogItem,
  Client,
  ClientBank,
  ClientPlace,
  ClientPosDevice,
  DeskEvent,
  Invoice,
  PctCode,
  PsidRecord,
  Purchase,
  ReturnPeriod,
  Settings,
} from "../types";

export type TokenHandling = "plain" | "stripped" | "encrypted";
export type ImportMode = "replace" | "merge";

const KDF_ITERATIONS = 210_000;
const TOKEN_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export interface TokenVault {
  kdf: "pbkdf2-sha256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface DeskBackup {
  version: 1 | 2 | 3 | 4 | 5;
  exportedAt: number;
  tokenHandling?: TokenHandling;
  tokenCount?: number;
  tokenVault?: TokenVault;
  settings: Settings | undefined;
  clients: Client[];
  invoices: Invoice[];
  purchases: Purchase[];
  returns: ReturnPeriod[];
  psids: PsidRecord[];
  events?: DeskEvent[];
  buyers?: Buyer[];
  items?: CatalogItem[];
  pctCodes?: PctCode[];
  clientPlaces?: ClientPlace[];
  clientBanks?: ClientBank[];
  clientPosDevices?: ClientPosDevice[];
}

export interface BackupPreview {
  clients: number;
  invoices: number;
  purchases: number;
  returns: number;
  psids: number;
  events: number;
  buyers: number;
  items: number;
  places: number;
  banks: number;
  posDevices: number;
  tokenHandling: TokenHandling;
  tokens: number;
}

export interface DeskSnapshot {
  settings: Settings | undefined;
  clients: Client[];
  invoices: Invoice[];
  purchases: Purchase[];
  returns: ReturnPeriod[];
  psids: PsidRecord[];
  events: DeskEvent[];
  buyers: Buyer[];
  items: CatalogItem[];
  pctCodes: PctCode[];
  clientPlaces: ClientPlace[];
  clientBanks: ClientBank[];
  clientPosDevices: ClientPosDevice[];
}

export function bytesToB64(bytes: Uint8Array): string {
  let text = "";
  bytes.forEach((byte) => {
    text += String.fromCharCode(byte);
  });
  return btoa(text);
}

export function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  extractable = false,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    extractable,
    ["encrypt", "decrypt"],
  );
}

function redactSecrets(value: string): string {
  return value.replace(TOKEN_RE, "[token hidden]");
}

function sanitizeEvent(event: DeskEvent): DeskEvent {
  return {
    ...event,
    title: redactSecrets(event.title),
    detail: redactSecrets(event.detail),
  };
}

function clientsWithoutTokens(clients: ReadonlyArray<Client>): Client[] {
  return clients.map((row) => ({ ...row, posToken: "" }));
}

function tokenMap(clients: ReadonlyArray<Client>): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const row of clients) {
    const token = row.posToken.trim();
    if (token) tokens[row.id] = token;
  }
  return tokens;
}

export function mergeById<T extends { id: string }>(existing: ReadonlyArray<T>, incoming: ReadonlyArray<T>): T[] {
  const map = new Map<string, T>();
  for (const row of existing) map.set(row.id, row);
  for (const row of incoming) map.set(row.id, row);
  return [...map.values()];
}

export function mergeNewestWins<T extends { id: string; updatedAt?: number }>(
  existing: ReadonlyArray<T>,
  incoming: ReadonlyArray<T>,
): T[] {
  const map = new Map<string, T>();
  for (const row of existing) map.set(row.id, row);
  for (const row of incoming) {
    const prev = map.get(row.id);
    if (!prev) {
      map.set(row.id, row);
      continue;
    }
    const prevAt = prev.updatedAt ?? 0;
    const nextAt = row.updatedAt ?? 0;
    if (nextAt >= prevAt) map.set(row.id, row);
  }
  return [...map.values()];
}

export function mergeInvoices(
  existing: ReadonlyArray<Invoice>,
  incoming: ReadonlyArray<Invoice>,
): Invoice[] {
  const map = new Map<string, Invoice>();
  for (const row of existing) map.set(row.id, row);
  for (const row of incoming) {
    const prev = map.get(row.id);
    if (!prev) {
      map.set(row.id, row);
      continue;
    }
    if (prev.status === "posted" && row.status !== "posted") continue;
    const prevAt = prev.updatedAt ?? 0;
    const nextAt = row.updatedAt ?? 0;
    if (nextAt >= prevAt) map.set(row.id, row);
  }
  return [...map.values()];
}

export function mergeClientsPreserveTokens(
  existing: ReadonlyArray<Client>,
  incoming: ReadonlyArray<Client>,
): Client[] {
  const map = new Map<string, Client>();
  for (const row of existing) map.set(row.id, row);
  for (const row of incoming) {
    const prev = map.get(row.id);
    if (!prev) {
      map.set(row.id, row);
      continue;
    }
    const prevAt = prev.updatedAt ?? 0;
    const nextAt = row.updatedAt ?? 0;
    if (nextAt < prevAt) continue;
    const token =
      row.posToken.trim() || prev.posToken.trim() ? row.posToken.trim() || prev.posToken : "";
    map.set(row.id, { ...row, posToken: token || prev.posToken });
  }
  return [...map.values()];
}

export function mergeDeskSettings(
  local: Settings | undefined,
  incoming: Settings | undefined,
): Settings | undefined {
  if (!incoming) return local;
  if (!local) return incoming;
  return {
    ...incoming,
    practicePinHash: local.practicePinHash,
    practicePinSalt: local.practicePinSalt,
    selectedClientId: local.selectedClientId,
  };
}

export function previewBackup(backup: DeskBackup): BackupPreview {
  const clients = backup.clients ?? [];
  const handling = backup.tokenHandling ?? "plain";
  const plainTokens = clients.filter((row) => row.posToken.trim()).length;
  const tokens =
    handling === "encrypted"
      ? (backup.tokenCount ?? 0)
      : handling === "stripped"
        ? (backup.tokenCount ?? 0)
        : plainTokens;
  return {
    clients: clients.length,
    invoices: backup.invoices?.length ?? 0,
    purchases: backup.purchases?.length ?? 0,
    returns: backup.returns?.length ?? 0,
    psids: backup.psids?.length ?? 0,
    events: backup.events?.length ?? 0,
    buyers: backup.buyers?.length ?? 0,
    items: backup.items?.length ?? 0,
    places: backup.clientPlaces?.length ?? 0,
    banks: backup.clientBanks?.length ?? 0,
    posDevices: backup.clientPosDevices?.length ?? 0,
    tokenHandling: handling,
    tokens,
  };
}

export function parseBackupText(text: string): DeskBackup {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("clients" in parsed)) {
    throw new Error("This file is not a Daftar backup.");
  }
  return parsed as DeskBackup;
}

async function encryptTokenVault(tokens: Record<string, string>, password: string): Promise<TokenVault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePasswordKey(password, salt);
  const payload = new TextEncoder().encode(JSON.stringify(tokens));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, key, payload);
  return {
    kdf: "pbkdf2-sha256",
    iterations: KDF_ITERATIONS,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(new Uint8Array(cipher)),
  };
}

export async function decryptTokenVault(vault: TokenVault, password: string): Promise<Record<string, string>> {
  try {
    const key = await derivePasswordKey(password, b64ToBytes(vault.salt));
    const iv = b64ToBytes(vault.iv);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      key,
      b64ToBytes(vault.ciphertext).buffer as ArrayBuffer,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
    if (typeof parsed !== "object" || parsed === null) throw new Error("bad vault");
    const tokens: Record<string, string> = {};
    for (const [id, token] of Object.entries(parsed)) {
      if (typeof token === "string" && token) tokens[id] = token;
    }
    return tokens;
  } catch {
    throw new Error("Password does not match this backup.");
  }
}

export async function assembleBackup(
  snapshot: DeskSnapshot,
  options: { tokenMode: "encrypt" | "strip"; password?: string },
): Promise<DeskBackup> {
  const tokens = tokenMap(snapshot.clients);
  const tokenCount = Object.keys(tokens).length;
  if (options.tokenMode === "encrypt" && !options.password?.trim()) {
    throw new Error("Enter a password to encrypt tokens.");
  }
  const backup: DeskBackup = {
    version: 5,
    exportedAt: Date.now(),
    tokenHandling: options.tokenMode === "encrypt" ? "encrypted" : "stripped",
    tokenCount,
    settings: snapshot.settings,
    clients: clientsWithoutTokens(snapshot.clients),
    invoices: snapshot.invoices,
    purchases: snapshot.purchases,
    returns: snapshot.returns,
    psids: snapshot.psids,
    events: snapshot.events.map(sanitizeEvent),
    buyers: snapshot.buyers,
    items: snapshot.items,
    pctCodes: snapshot.pctCodes,
    clientPlaces: snapshot.clientPlaces,
    clientBanks: snapshot.clientBanks,
    clientPosDevices: snapshot.clientPosDevices,
  };
  if (options.tokenMode === "encrypt" && options.password) {
    backup.tokenVault = await encryptTokenVault(tokens, options.password);
  }
  return backup;
}

export async function prepareImport(backup: DeskBackup, password?: string): Promise<DeskBackup> {
  const handling = backup.tokenHandling ?? "plain";
  if (handling !== "encrypted") {
    return {
      ...backup,
      clients: (backup.clients ?? []).map((row) => ({ ...row, posToken: handling === "stripped" ? "" : row.posToken })),
    };
  }
  if (!backup.tokenVault) throw new Error("This backup is marked encrypted but has no token vault.");
  if (!password?.trim()) throw new Error("This backup’s tokens are encrypted. Enter the password.");
  const tokens = await decryptTokenVault(backup.tokenVault, password);
  return {
    ...backup,
    clients: (backup.clients ?? []).map((row) => ({
      ...row,
      posToken: tokens[row.id] ?? "",
    })),
  };
}

async function readSnapshot(): Promise<DeskSnapshot> {
  return {
    settings: await db.settings.get("desk"),
    clients: await db.clients.toArray(),
    invoices: await db.invoices.toArray(),
    purchases: await db.purchases.toArray(),
    returns: await db.returns.toArray(),
    psids: await db.psids.toArray(),
    events: await db.events.toArray(),
    buyers: await db.buyers.toArray(),
    items: await db.items.toArray(),
    pctCodes: await db.pctCodes.toArray(),
    clientPlaces: await db.clientPlaces.toArray(),
    clientBanks: await db.clientBanks.toArray(),
    clientPosDevices: await db.clientPosDevices.toArray(),
  };
}

function downloadJson(backup: DeskBackup, filename: string): void {
  // Stream per table: each array is stringified on its own, then joined into one Blob.
  const parts: BlobPart[] = ["{\n"];
  const entries: Array<[string, unknown]> = [
    ["version", backup.version],
    ["exportedAt", backup.exportedAt],
    ["tokenHandling", backup.tokenHandling ?? null],
    ["tokenCount", backup.tokenCount ?? null],
    ["tokenVault", backup.tokenVault ?? null],
    ["settings", backup.settings ?? null],
    ["clients", backup.clients ?? []],
    ["invoices", backup.invoices ?? []],
    ["purchases", backup.purchases ?? []],
    ["returns", backup.returns ?? []],
    ["psids", backup.psids ?? []],
    ["events", backup.events ?? []],
    ["buyers", backup.buyers ?? []],
    ["items", backup.items ?? []],
    ["pctCodes", backup.pctCodes ?? []],
    ["clientPlaces", backup.clientPlaces ?? []],
    ["clientBanks", backup.clientBanks ?? []],
    ["clientPosDevices", backup.clientPosDevices ?? []],
  ];
  entries.forEach(([key, value], index) => {
    const comma = index < entries.length - 1 ? ",\n" : "\n";
    parts.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
  });
  parts.push("}\n");
  const blob = new Blob(parts, { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function filterSnapshot(snapshot: DeskSnapshot, clientId: string): DeskSnapshot {
  return {
    ...snapshot,
    clients: snapshot.clients.filter((row) => row.id === clientId),
    invoices: snapshot.invoices.filter((row) => row.clientId === clientId),
    purchases: snapshot.purchases.filter((row) => row.clientId === clientId),
    returns: snapshot.returns.filter((row) => row.clientId === clientId),
    psids: snapshot.psids.filter((row) => row.clientId === clientId),
    events: snapshot.events.filter((row) => row.clientId === clientId),
    buyers: snapshot.buyers.filter((row) => row.clientId === clientId),
    items: snapshot.items.filter((row) => row.clientId === clientId),
    clientPlaces: snapshot.clientPlaces.filter((row) => row.clientId === clientId),
    clientBanks: snapshot.clientBanks.filter((row) => row.clientId === clientId),
    clientPosDevices: snapshot.clientPosDevices.filter((row) => row.clientId === clientId),
  };
}

export function backupDownloadName(at = new Date(), clientId?: string): string {
  const day = formatDay(at);
  return clientId ? `daftar-client-${day}.json` : `daftar-backup-${day}.json`;
}

export async function exportBackup(options: {
  tokenMode: "encrypt" | "strip";
  password?: string;
  clientId?: string;
}): Promise<void> {
  const snapshot = await readSnapshot();
  const scoped = options.clientId ? filterSnapshot(snapshot, options.clientId) : snapshot;
  if (options.clientId && scoped.clients.length === 0) {
    throw new Error("That client is not on this desk.");
  }
  const backup = await assembleBackup(scoped, options);
  downloadJson(backup, backupDownloadName(new Date(), options.clientId));
}

/** One-way server push: full desk snapshot with plain tokens (local API / M1). */
export async function buildServerPushBackup(): Promise<DeskBackup> {
  const snapshot = await readSnapshot();
  const tokens = tokenMap(snapshot.clients);
  return {
    version: 5,
    exportedAt: Date.now(),
    tokenHandling: "plain",
    tokenCount: Object.keys(tokens).length,
    settings: snapshot.settings,
    clients: snapshot.clients,
    invoices: snapshot.invoices,
    purchases: snapshot.purchases,
    returns: snapshot.returns,
    psids: snapshot.psids,
    events: snapshot.events.map(sanitizeEvent),
    buyers: snapshot.buyers,
    items: snapshot.items,
    pctCodes: snapshot.pctCodes,
    clientPlaces: snapshot.clientPlaces,
    clientBanks: snapshot.clientBanks,
    clientPosDevices: snapshot.clientPosDevices,
  };
}

export async function applyBackup(backup: DeskBackup, mode: ImportMode): Promise<BackupPreview> {
  const incomingSettings = backup.settings
    ? { ...backup.settings, workingPeriod: backup.settings.workingPeriod || currentPeriod() }
    : undefined;
  const incoming = {
    clients: backup.clients ?? [],
    invoices: backup.invoices ?? [],
    purchases: backup.purchases ?? [],
    returns: backup.returns ?? [],
    psids: backup.psids ?? [],
    events: (backup.events ?? []).map(sanitizeEvent),
    buyers: backup.buyers ?? [],
    items: backup.items ?? [],
    pctCodes: backup.pctCodes ?? [],
    clientPlaces: backup.clientPlaces ?? [],
    clientBanks: backup.clientBanks ?? [],
    clientPosDevices: backup.clientPosDevices ?? [],
  };

  await db.transaction(
    "rw",
    [
      db.settings,
      db.clients,
      db.invoices,
      db.purchases,
      db.returns,
      db.psids,
      db.events,
      db.buyers,
      db.items,
      db.pctCodes,
      db.clientPlaces,
      db.clientBanks,
      db.clientPosDevices,
    ],
    async () => {
      if (mode === "replace") {
        await db.settings.clear();
        await db.clients.clear();
        await db.invoices.clear();
        await db.purchases.clear();
        await db.returns.clear();
        await db.psids.clear();
        await db.events.clear();
        await db.buyers.clear();
        await db.items.clear();
        await db.pctCodes.clear();
        await db.clientPlaces.clear();
        await db.clientBanks.clear();
        await db.clientPosDevices.clear();
        if (incomingSettings) await db.settings.put(incomingSettings);
        if (incoming.clients.length) await db.clients.bulkPut(incoming.clients);
        if (incoming.invoices.length) await db.invoices.bulkPut(incoming.invoices);
        if (incoming.purchases.length) await db.purchases.bulkPut(incoming.purchases);
        if (incoming.returns.length) await db.returns.bulkPut(incoming.returns);
        if (incoming.psids.length) await db.psids.bulkPut(incoming.psids);
        if (incoming.events.length) await db.events.bulkPut(incoming.events);
        if (incoming.buyers.length) await db.buyers.bulkPut(incoming.buyers);
        if (incoming.items.length) await db.items.bulkPut(incoming.items);
        if (incoming.pctCodes.length) await db.pctCodes.bulkPut(incoming.pctCodes);
        if (incoming.clientPlaces.length) await db.clientPlaces.bulkPut(incoming.clientPlaces);
        if (incoming.clientBanks.length) await db.clientBanks.bulkPut(incoming.clientBanks);
        if (incoming.clientPosDevices.length) await db.clientPosDevices.bulkPut(incoming.clientPosDevices);
        return;
      }

      const [localSettings, localClients, localInvoices, localPurchases, localReturns, localPsids, localEvents, localBuyers, localItems, localPct, localPlaces, localBanks, localDevices] =
        await Promise.all([
          db.settings.get("desk"),
          db.clients.toArray(),
          db.invoices.toArray(),
          db.purchases.toArray(),
          db.returns.toArray(),
          db.psids.toArray(),
          db.events.toArray(),
          db.buyers.toArray(),
          db.items.toArray(),
          db.pctCodes.toArray(),
          db.clientPlaces.toArray(),
          db.clientBanks.toArray(),
          db.clientPosDevices.toArray(),
        ]);

      const settings = mergeDeskSettings(localSettings, incomingSettings);
      if (settings) await db.settings.put(settings);
      await db.clients.bulkPut(mergeClientsPreserveTokens(localClients, incoming.clients));
      await db.invoices.bulkPut(mergeInvoices(localInvoices, incoming.invoices));
      await db.purchases.bulkPut(mergeNewestWins(localPurchases, incoming.purchases));
      await db.returns.bulkPut(mergeNewestWins(localReturns, incoming.returns));
      await db.psids.bulkPut(mergeNewestWins(localPsids, incoming.psids));
      await db.events.bulkPut(mergeById(localEvents, incoming.events));
      await db.buyers.bulkPut(mergeNewestWins(localBuyers, incoming.buyers));
      await db.items.bulkPut(mergeNewestWins(localItems, incoming.items));
      await db.pctCodes.bulkPut(mergeById(localPct, incoming.pctCodes));
      await db.clientPlaces.bulkPut(mergeNewestWins(localPlaces, incoming.clientPlaces));
      await db.clientBanks.bulkPut(mergeNewestWins(localBanks, incoming.clientBanks));
      await db.clientPosDevices.bulkPut(mergeNewestWins(localDevices, incoming.clientPosDevices));
    },
  );
  await logEvent({
    kind: "backup.imported",
    title: mode === "merge" ? "Desk backup merged" : "Desk backup imported",
    detail: mode === "merge" ? "Merged by id (newest wins; posted protected)" : "Replaced desk",
  });
  const written = await db.settings.get("desk");
  const { hasPracticePin, lockPractice } = await import("../domain/settings");
  if (hasPracticePin(written)) lockPractice();
  return previewBackup(backup);
}

/** @deprecated Use parseBackupText + preview + applyBackup after confirm. */
export async function importBackup(_file?: File): Promise<never> {
  throw new Error("Use previewBackup + applyBackup after confirm.");
}
