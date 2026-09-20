import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PsidRecord } from "../types";

const { store } = vi.hoisted(() => ({
  store: new Map<string, PsidRecord>(),
}));

vi.mock("../hooks/useLive", () => ({ notifyDb: () => undefined }));
vi.mock("./events", () => ({ logEvent: async () => undefined }));
vi.mock("../db", () => ({
  db: {
    psids: {
      get: async (id: string) => store.get(id),
      add: async (row: PsidRecord) => {
        store.set(row.id, row);
      },
      put: async (row: PsidRecord) => {
        store.set(row.id, row);
      },
    },
  },
}));

import { paidAmountFor, savePsid } from "./psids";

beforeEach(() => {
  store.clear();
});

describe("savePsid", () => {
  it("updates the same id on a second save and defaults paidAmount", async () => {
    expect(paidAmountFor({ amount: 500, status: "paid" })).toBe(500);
    expect(paidAmountFor({ amount: 500, status: "planned" })).toBe(0);
    expect(paidAmountFor({ amount: 500, status: "paid", paidAmount: 120 })).toBe(120);
    const first = await savePsid({
      clientId: "cli_1",
      period: "2026-09",
      amount: 1000,
      head: "PST",
      psid: "1234567890123",
      cpr: "",
      bank: "",
      paidOn: "",
      status: "generated",
      notes: "",
      dueOn: "2026-10-15",
    });
    expect(first.record?.id).toBeTruthy();
    expect(first.record?.dueOn).toBe("2026-10-15");
    expect(first.record?.paidAmount).toBe(0);
    const second = await savePsid({
      id: first.record?.id,
      clientId: "cli_1",
      period: "2026-09",
      amount: 1000,
      head: "PST",
      psid: "1234567890123",
      cpr: "CPR-1",
      bank: "HBL",
      paidOn: "2026-10-01",
      status: "paid",
      notes: "",
      dueOn: "2026-10-15",
    });
    expect(second.record?.id).toBe(first.record?.id);
    expect(second.record?.paidAmount).toBe(1000);
    expect(second.record?.cpr).toBe("CPR-1");
    expect(store.size).toBe(1);
  });
});
