import Dexie, { type Table } from "dexie";
import { formatDateTime } from "./lib/format";
import { currentPeriod, newId } from "./lib/ids";
import { extraPctIds, PUNJAB_SERVICE_RATES } from "./domain/catalog";
import { emptyDeskSettings, shouldSeedDemoClient } from "./lib/seed";
import { PRA_SANDBOX_TOKEN } from "./types";
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
} from "./types";

export class DaftarDB extends Dexie {
  settings!: Table<Settings, string>;
  clients!: Table<Client, string>;
  invoices!: Table<Invoice, string>;
  purchases!: Table<Purchase, string>;
  returns!: Table<ReturnPeriod, string>;
  psids!: Table<PsidRecord, string>;
  events!: Table<DeskEvent, string>;
  buyers!: Table<Buyer, string>;
  items!: Table<CatalogItem, string>;
  pctCodes!: Table<PctCode, string>;
  clientPlaces!: Table<ClientPlace, string>;
  clientBanks!: Table<ClientBank, string>;
  clientPosDevices!: Table<ClientPosDevice, string>;

  constructor() {
    super("daftar-pra");
    this.version(1).stores({
      settings: "id",
      clients: "id, businessName, pntn, updatedAt",
      invoices: "id, clientId, status, usin, createdAt",
      purchases: "id, clientId, period, createdAt",
      returns: "id, clientId, period, [clientId+period]",
      psids: "id, clientId, period, status, createdAt",
    });
    this.version(2).stores({
      settings: "id",
      clients: "id, businessName, pntn, updatedAt",
      invoices: "id, clientId, status, usin, createdAt, [clientId+usin]",
      purchases: "id, clientId, period, createdAt",
      returns: "id, clientId, period, [clientId+period]",
      psids: "id, clientId, period, status, createdAt",
      events: "id, clientId, kind, createdAt",
    });
    this.version(3).stores({
      settings: "id",
      clients: "id, businessName, pntn, updatedAt",
      invoices: "id, clientId, status, usin, createdAt, [clientId+usin]",
      purchases: "id, clientId, period, createdAt",
      returns: "id, clientId, period, [clientId+period]",
      psids: "id, clientId, period, status, createdAt",
      events: "id, clientId, kind, createdAt",
      buyers: "id, clientId, name, pntn, updatedAt, [clientId+name]",
      items: "id, clientId, itemCode, pctCode, updatedAt, [clientId+itemCode]",
      pctCodes: "id, pctCode, name, taxRate",
    });
    this.version(4).stores({
      invoices: "id, clientId, status, usin, createdAt, &[clientId+usin]",
      returns: "id, clientId, period, &[clientId+period]",
      clientPlaces: "id, clientId, isPrimary, updatedAt, [clientId+label]",
      clientBanks: "id, clientId, isPrimary, updatedAt",
      clientPosDevices: "id, clientId, placeId, posId, updatedAt",
    });
    this.version(5).stores({
      invoices: "id, clientId, status, usin, createdAt, &[clientId+usin], inFlightAt",
    });
  }
}

export const db = new DaftarDB();

export async function seedPctCatalog(): Promise<void> {
  await db.transaction("rw", db.pctCodes, async () => {
    const existing = await db.pctCodes.toArray();
    const extras = extraPctIds(existing);
    if (extras.length) await db.pctCodes.bulkDelete(extras);
    const have = new Set(existing.filter((row) => !extras.includes(row.id)).map((row) => row.pctCode));
    const now = Date.now();
    const missing = PUNJAB_SERVICE_RATES.filter((row) => !have.has(row.pctCode)).map((row) => ({
      id: newId("pct"),
      pctCode: row.pctCode,
      name: row.name,
      taxRate: row.taxRate,
      seeded: true,
      createdAt: now,
      updatedAt: now,
    }));
    if (missing.length) await db.pctCodes.bulkAdd(missing);
  });
}

export async function ensureSeed(): Promise<void> {
  const { sweepHungInFlight } = await import("./domain/invoices");
  await sweepHungInFlight();
  await seedPctCatalog();

  const demos = await db.clients.where("businessName").equals("Demo Traders (Sandbox)").toArray();
  if (demos.length > 1) {
    const keep = demos[0];
    if (keep) {
      await db.clients.bulkDelete(demos.slice(1).map((row) => row.id));
      const settings = await db.settings.get("desk");
      if (settings) await db.settings.put({ ...settings, selectedClientId: keep.id });
    }
  }

  const existing = await db.settings.get("desk");
  if (existing) {
    if (!existing.workingPeriod) {
      await db.settings.put({ ...existing, workingPeriod: currentPeriod() });
    }
    return;
  }

  const now = Date.now();
  if (!shouldSeedDemoClient(import.meta.env.PROD)) {
    await db.settings.put(emptyDeskSettings());
    return;
  }

  const demoId = newId("cli");
  await db.transaction("rw", db.settings, db.clients, async () => {
    const again = await db.settings.get("desk");
    if (again) return;
    await db.settings.put({
      id: "desk",
      firmName: "My practice",
      selectedClientId: demoId,
      workingPeriod: currentPeriod(),
    });
    await db.clients.add({
      id: demoId,
      businessName: "Demo Traders (Sandbox)",
      brandName: "Demo",
      pntn: "1234567-8",
      cnic: "",
      phone: "03001234567",
      email: "demo@example.com",
      address: "Lahore",
      city: "Lahore",
      sector: "Consultancy",
      branchName: "Head office",
      posId: "100000",
      posToken: PRA_SANDBOX_TOKEN,
      environment: "sandbox",
      notes: "Sample client. Replace POS ID and token with the values from PRA IRIS → eIMS / POS registration before live posting.",
      createdAt: now,
      updatedAt: now,
    });
  });
}

export function emptyInvoice(clientId: string, usin: string, at = new Date()): Invoice {
  const now = Date.now();
  return {
    id: newId("inv"),
    clientId,
    usin,
    invoiceType: 1,
    paymentMode: 1,
    dateTime: formatDateTime(at),
    buyerName: "",
    buyerPntn: "",
    buyerCnic: "",
    buyerPhone: "",
    discount: 0,
    furtherTax: 0,
    extraTax: 0,
    stWithheld: 0,
    reverseCharge: false,
    saleType: "Services",
    taxpayerType: "",
    buyerDistrict: "",
    totalQuantity: 0,
    totalSaleValue: 0,
    totalTaxCharged: 0,
    totalBillAmount: 0,
    refUsin: "",
    items: [],
    status: "draft",
    fiscalNumber: "",
    lastError: "",
    lastResponse: "",
    lastCode: "",
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
