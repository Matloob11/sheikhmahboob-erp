import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, DeskEvent, Settings } from "../types";

const { deskState, lockPractice } = vi.hoisted(() => ({
  deskState: { settings: undefined as Settings | undefined },
  lockPractice: vi.fn(),
}));

vi.mock("../domain/events", () => ({ logEvent: async () => undefined }));
vi.mock("../domain/settings", () => ({
  hasPracticePin: (settings?: Settings) => Boolean(settings?.practicePinHash && settings.practicePinSalt),
  lockPractice,
}));
vi.mock("../db", () => {
  const noop = async () => undefined;
  return {
    db: {
      settings: {
        get: async () => deskState.settings,
        put: async (row: Settings) => {
          deskState.settings = row;
        },
        clear: async () => {
          deskState.settings = undefined;
        },
      },
      clients: { clear: noop, bulkPut: noop },
      invoices: { clear: noop, bulkPut: noop },
      purchases: { clear: noop, bulkPut: noop },
      returns: { clear: noop, bulkPut: noop },
      psids: { clear: noop, bulkPut: noop },
      events: { clear: noop, bulkPut: noop },
      buyers: { clear: noop, bulkPut: noop },
      items: { clear: noop, bulkPut: noop },
      pctCodes: { clear: noop, bulkPut: noop },
      clientPlaces: { clear: noop, bulkPut: noop },
      clientBanks: { clear: noop, bulkPut: noop },
      clientPosDevices: { clear: noop, bulkPut: noop },
      transaction: async (_mode: string, _tables: unknown, fn: () => Promise<void>) => fn(),
    },
  };
});

import {
  applyBackup,
  assembleBackup,
  importBackup,
  mergeById,
  parseBackupText,
  prepareImport,
  previewBackup,
  type DeskSnapshot,
} from "./backup";

function client(id: string, token: string): Client {
  return {
    id,
    businessName: id,
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
    posToken: token,
    environment: "sandbox",
    notes: "",
    createdAt: 1,
    updatedAt: 1,
  };
}

function snapshot(overrides: Partial<DeskSnapshot> = {}): DeskSnapshot {
  return {
    settings: { id: "desk", firmName: "Test", workingPeriod: "2026-09" },
    clients: [client("cli_1", "24d8fab3-f2e9-398f-ae17-b387125ec4a2")],
    invoices: [],
    purchases: [],
    returns: [],
    psids: [],
    events: [
      {
        id: "evt_1",
        kind: "client.saved",
        title: "Opened file for Demo",
        detail: "token 24d8fab3-f2e9-398f-ae17-b387125ec4a2 must not leak",
        createdAt: 1,
      } satisfies DeskEvent,
    ],
    buyers: [],
    items: [],
    pctCodes: [],
    clientPlaces: [],
    clientBanks: [],
    clientPosDevices: [],
    ...overrides,
  };
}

beforeEach(() => {
  deskState.settings = undefined;
  lockPractice.mockReset();
});

describe("backup preview and merge", () => {
  it("previews counts and treats legacy files as plain tokens", () => {
    const preview = previewBackup({
      version: 2,
      exportedAt: 1,
      settings: undefined,
      clients: [client("cli_1", "secret-token"), client("cli_2", "")],
      invoices: [{ id: "inv_1" } as never],
      purchases: [],
      returns: [],
      psids: [{ id: "psd_1" } as never, { id: "psd_2" } as never],
      buyers: [{ id: "buy_1" } as never],
      items: [{ id: "itm_1" } as never, { id: "itm_2" } as never],
    });
    expect(preview.clients).toBe(2);
    expect(preview.invoices).toBe(1);
    expect(preview.psids).toBe(2);
    expect(preview.buyers).toBe(1);
    expect(preview.items).toBe(2);
    expect(preview.places).toBe(0);
    expect(preview.banks).toBe(0);
    expect(preview.posDevices).toBe(0);
    expect(preview.tokenHandling).toBe("plain");
    expect(preview.tokens).toBe(1);
  });

  it("exports backup version 5 and keeps local-only places on merge", async () => {
    const backup = await assembleBackup(
      snapshot({
        clientPlaces: [
          {
            id: "plc_in",
            clientId: "cli_1",
            label: "Incoming",
            address: "",
            city: "",
            district: "",
            province: "",
            branchId: "",
            isPrimary: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
      { tokenMode: "strip" },
    );
    expect(backup.version).toBe(5);
    const preview = previewBackup(backup);
    expect(preview.places).toBe(1);
    const local = [
      {
        id: "plc_local",
        clientId: "cli_1",
        label: "Local only",
        address: "",
        city: "",
        district: "",
        province: "",
        branchId: "",
        isPrimary: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    expect(mergeById(local, backup.clientPlaces ?? []).map((row) => row.id)).toEqual(["plc_local", "plc_in"]);
    const legacy = parseBackupText(
      JSON.stringify({
        version: 4,
        exportedAt: 1,
        settings: undefined,
        clients: [client("cli_1", "")],
        invoices: [],
        purchases: [],
        returns: [],
        psids: [],
      }),
    );
    expect(previewBackup(legacy).places).toBe(0);
    expect(legacy.clientPlaces ?? []).toEqual([]);
  });

  it("merges by id without dropping local-only rows", () => {
    const existing = [
      { id: "a", name: "keep-unless-replaced" },
      { id: "b", name: "old-b" },
    ];
    const incoming = [
      { id: "b", name: "new-b" },
      { id: "c", name: "added" },
    ];
    expect(mergeById(existing, incoming)).toEqual([
      { id: "a", name: "keep-unless-replaced" },
      { id: "b", name: "new-b" },
      { id: "c", name: "added" },
    ]);
  });

  it("strips tokens and redacts activity on export", async () => {
    const backup = await assembleBackup(snapshot(), { tokenMode: "strip" });
    expect(backup.tokenHandling).toBe("stripped");
    expect(backup.tokenCount).toBe(1);
    expect(backup.clients[0]?.posToken).toBe("");
    expect(backup.events?.[0]?.detail).toContain("[token hidden]");
    expect(JSON.stringify(backup)).not.toContain("24d8fab3-f2e9-398f-ae17-b387125ec4a2");
    const prepared = await prepareImport(backup);
    expect(prepared.clients[0]?.posToken).toBe("");
  });

  it("encrypts tokens and restores them with the password", async () => {
    const backup = await assembleBackup(snapshot(), { tokenMode: "encrypt", password: "desk-key" });
    expect(backup.tokenHandling).toBe("encrypted");
    expect(backup.clients[0]?.posToken).toBe("");
    expect(backup.tokenVault?.ciphertext).toBeTruthy();
    expect(JSON.stringify(backup)).not.toContain("24d8fab3-f2e9-398f-ae17-b387125ec4a2");
    const preview = previewBackup(backup);
    expect(preview.tokens).toBe(1);
    const restored = await prepareImport(backup, "desk-key");
    expect(restored.clients[0]?.posToken).toBe("24d8fab3-f2e9-398f-ae17-b387125ec4a2");
    await expect(prepareImport(backup, "wrong")).rejects.toThrow(/Password does not match/);
  });

  it("round-trips a stripped backup through JSON", async () => {
    const original = snapshot({
      invoices: [{ id: "inv_1" } as never],
      purchases: [{ id: "pur_1" } as never],
    });
    const backup = await assembleBackup(original, { tokenMode: "strip" });
    const again = parseBackupText(JSON.stringify(backup));
    expect(again.version).toBe(backup.version);
    expect(again.clients).toEqual(backup.clients);
    expect(again.invoices).toEqual(backup.invoices);
    expect(again.purchases).toEqual(backup.purchases);
    expect(again.settings).toEqual(original.settings);
    expect(again.clients[0]?.posToken).toBe("");
  });
});

describe("backup restore lock", () => {
  it("does not leave a preview-less public import path", async () => {
    await expect(importBackup(new File(["{}"], "desk.json"))).rejects.toThrow(/previewBackup/);
  });

  it("locks the desk after restore when a practice PIN is present", async () => {
    await applyBackup(
      {
        version: 4,
        exportedAt: 1,
        settings: {
          id: "desk",
          firmName: "Test",
          workingPeriod: "2026-09",
          practicePinHash: "hash",
          practicePinSalt: "salt",
        },
        clients: [],
        invoices: [],
        purchases: [],
        returns: [],
        psids: [],
      },
      "replace",
    );
    expect(lockPractice).toHaveBeenCalledTimes(1);
  });

  it("does not lock when the restored desk has no PIN", async () => {
    await applyBackup(
      {
        version: 4,
        exportedAt: 1,
        settings: { id: "desk", firmName: "Test", workingPeriod: "2026-09" },
        clients: [],
        invoices: [],
        purchases: [],
        returns: [],
        psids: [],
      },
      "replace",
    );
    expect(lockPractice).not.toHaveBeenCalled();
  });
});
