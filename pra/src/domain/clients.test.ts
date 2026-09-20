import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Buyer, CatalogItem, Client, ClientBank, ClientPlace, ClientPosDevice, DeskEvent, Invoice } from "../types";

type Row = { id: string; clientId?: string };

const { stores } = vi.hoisted(() => {
  const empty = () => ({
    clients: new Map<string, Client>(),
    invoices: new Map<string, Invoice & Row>(),
    purchases: new Map<string, Row>(),
    returns: new Map<string, Row>(),
    psids: new Map<string, Row>(),
    buyers: new Map<string, Buyer>(),
    items: new Map<string, CatalogItem>(),
    events: new Map<string, DeskEvent>(),
    clientPlaces: new Map<string, ClientPlace>(),
    clientBanks: new Map<string, ClientBank>(),
    clientPosDevices: new Map<string, ClientPosDevice>(),
  });
  return { stores: empty() };
});

function table<T extends Row>(store: Map<string, T>) {
  return {
    get: async (id: string) => store.get(id),
    delete: async (id: string) => {
      store.delete(id);
    },
    bulkDelete: async (ids: string[]) => {
      for (const id of ids) store.delete(id);
    },
    where: (index: string) => ({
      equals: (key: string) => ({
        toArray: async () =>
          [...store.values()].filter((row) => (index === "clientId" ? row.clientId === key : false)),
      }),
    }),
  };
}

vi.mock("../hooks/useLive", () => ({ notifyDb: () => undefined }));
vi.mock("./events", () => ({ logEvent: async () => undefined }));
vi.mock("../db", () => ({
  db: {
    clients: table(stores.clients),
    invoices: table(stores.invoices),
    purchases: table(stores.purchases),
    returns: table(stores.returns),
    psids: table(stores.psids),
    buyers: table(stores.buyers),
    items: table(stores.items),
    events: table(stores.events),
    clientPlaces: table(stores.clientPlaces),
    clientBanks: table(stores.clientBanks),
    clientPosDevices: table(stores.clientPosDevices),
    transaction: async (_mode: string, _tables: unknown, fn: () => Promise<void>) => fn(),
  },
}));

import { hasClientRegistration, registrationDisplay, removeClientFile } from "./clients";

const client: Client = {
  id: "cli_1",
  businessName: "Demo",
  brandName: "",
  pntn: "1234567-8",
  cnic: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  sector: "Consultancy",
  branchName: "",
  posId: "100000",
  posToken: "",
  environment: "sandbox",
  notes: "",
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  for (const store of Object.values(stores)) store.clear();
  stores.clients.set(client.id, client);
  stores.invoices.set("inv_1", { id: "inv_1", clientId: "cli_1" } as Invoice);
  stores.buyers.set("buy_1", { id: "buy_1", clientId: "cli_1" } as Buyer);
  stores.items.set("itm_1", { id: "itm_1", clientId: "cli_1" } as CatalogItem);
  stores.events.set("evt_1", { id: "evt_1", clientId: "cli_1", kind: "invoice.saved", title: "x", detail: "", createdAt: 1 });
  stores.buyers.set("buy_other", { id: "buy_other", clientId: "cli_2" } as Buyer);
  stores.clientPlaces.set("plc_1", { id: "plc_1", clientId: "cli_1" } as ClientPlace);
  stores.clientBanks.set("bnk_1", { id: "bnk_1", clientId: "cli_1" } as ClientBank);
  stores.clientPosDevices.set("pos_1", { id: "pos_1", clientId: "cli_1" } as ClientPosDevice);
});

describe("removeClientFile", () => {
  it("cascades buyers, items, events, and invoices", async () => {
    await removeClientFile("cli_1", true);
    expect(stores.clients.has("cli_1")).toBe(false);
    expect(stores.invoices.has("inv_1")).toBe(false);
    expect(stores.buyers.has("buy_1")).toBe(false);
    expect(stores.items.has("itm_1")).toBe(false);
    expect(stores.events.has("evt_1")).toBe(false);
    expect(stores.clientPlaces.has("plc_1")).toBe(false);
    expect(stores.clientBanks.has("bnk_1")).toBe(false);
    expect(stores.clientPosDevices.has("pos_1")).toBe(false);
    expect(stores.buyers.has("buy_other")).toBe(true);
  });

  it("leaves related papers when cascade is off", async () => {
    await removeClientFile("cli_1", false);
    expect(stores.clients.has("cli_1")).toBe(false);
    expect(stores.invoices.has("inv_1")).toBe(true);
    expect(stores.buyers.has("buy_1")).toBe(true);
    expect(stores.clientPlaces.has("plc_1")).toBe(true);
  });
});

describe("hasClientRegistration", () => {
  it("accepts PNTN or a 13-digit CNIC marked as registration", () => {
    expect(hasClientRegistration({ pntn: "1234567-8", cnic: "", cnicAsRegistration: false })).toBe(true);
    expect(
      hasClientRegistration({ pntn: "", cnic: "3520212345671", cnicAsRegistration: true }),
    ).toBe(true);
    expect(hasClientRegistration({ pntn: "", cnic: "35202", cnicAsRegistration: true })).toBe(false);
    expect(hasClientRegistration({ pntn: "", cnic: "3520212345671", cnicAsRegistration: false })).toBe(false);
    expect(registrationDisplay({ pntn: "", cnic: "3520212345671", cnicAsRegistration: true })).toBe(
      "3520212345671",
    );
    expect(registrationDisplay({ pntn: "1234567-8", cnic: "3520212345671", cnicAsRegistration: true })).toBe(
      "1234567-8",
    );
  });
});
