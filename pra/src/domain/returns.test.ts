import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Purchase, ReturnPeriod } from "../types";

const { returnStore, purchaseStore } = vi.hoisted(() => ({
  returnStore: new Map<string, ReturnPeriod>(),
  purchaseStore: new Map<string, Purchase>(),
}));

vi.mock("../hooks/useLive", () => ({ notifyDb: () => undefined }));
vi.mock("./events", () => ({ logEvent: async () => undefined }));
vi.mock("../db", () => ({
  db: {
    returns: {
      put: async (row: ReturnPeriod) => {
        returnStore.set(row.id, row);
      },
      where: (index: string) => ({
        equals: (key: [string, string]) => ({
          toArray: async () => {
            if (index !== "[clientId+period]") return [...returnStore.values()];
            const [clientId, period] = key;
            return [...returnStore.values()].filter((row) => row.clientId === clientId && row.period === period);
          },
        }),
      }),
    },
    purchases: {
      get: async (id: string) => purchaseStore.get(id),
      add: async (row: Purchase) => {
        purchaseStore.set(row.id, row);
      },
      put: async (row: Purchase) => {
        purchaseStore.set(row.id, row);
      },
    },
  },
}));

import { findReturnForPeriod, markReturn, pickReturnForPeriod, savePurchase } from "./returns";

function row(partial: Partial<ReturnPeriod> & Pick<ReturnPeriod, "id" | "updatedAt">): ReturnPeriod {
  return {
    clientId: "cli_1",
    period: "2026-09",
    status: "open",
    notes: "",
    createdAt: 1,
    ...partial,
  };
}

beforeEach(() => {
  returnStore.clear();
  purchaseStore.clear();
});

describe("return uniqueness", () => {
  it("picks the latest updatedAt when two rows share a period", () => {
    const older = row({ id: "ret_old", status: "open", updatedAt: 10 });
    const newer = row({ id: "ret_new", status: "filed", updatedAt: 20 });
    expect(pickReturnForPeriod([older, newer], "cli_1", "2026-09")?.id).toBe("ret_new");
    expect(pickReturnForPeriod([newer, older], "cli_1", "2026-09")?.id).toBe("ret_new");
    expect(pickReturnForPeriod([newer, older], "cli_1", "2026-08")).toBeUndefined();
  });

  it("updates the existing period row instead of inserting a second id", async () => {
    const first = await markReturn({ clientId: "cli_1", period: "2026-09", status: "ready" });
    const second = await markReturn({ clientId: "cli_1", period: "2026-09", status: "filed" });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("filed");
    expect(returnStore.size).toBe(1);
    expect((await findReturnForPeriod("cli_1", "2026-09"))?.status).toBe("filed");
  });

  it("sets filedAt and irisAck without wiping them on a later mark", async () => {
    const first = await markReturn({
      clientId: "cli_1",
      period: "2026-09",
      status: "filed",
      irisAck: "ACK-1",
    });
    expect(first.filedAt).toBeGreaterThan(0);
    expect(first.irisAck).toBe("ACK-1");
    const again = await markReturn({ clientId: "cli_1", period: "2026-09", status: "filed" });
    expect(again.id).toBe(first.id);
    expect(again.filedAt).toBe(first.filedAt);
    expect(again.irisAck).toBe("ACK-1");
  });
});

describe("purchase extras", () => {
  it("updates an existing purchase and sets updatedAt plus extras", async () => {
    const created = await savePurchase({
      clientId: "cli_1",
      period: "2026-09",
      supplierName: "Supplier",
      supplierPntn: "1234567-8",
      invoiceNo: "A-1",
      invoiceDate: "2026-09-01",
      saleValue: 100,
      taxRate: 16,
      supplierCnic: "3520212345671",
      blockedCredit: true,
    });
    expect(created.purchase?.supplierCnic).toBe("3520212345671");
    expect(created.purchase?.blockedCredit).toBe(true);
    expect(created.purchase?.updatedAt).toBeGreaterThan(0);
    const later = await savePurchase({
      id: created.purchase?.id,
      clientId: "cli_1",
      period: "2026-09",
      supplierName: "Supplier",
      supplierPntn: "1234567-8",
      invoiceNo: "A-1",
      invoiceDate: "2026-09-01",
      saleValue: 200,
      taxRate: 16,
      supplierCnic: "3520212345671",
      blockedCredit: true,
    });
    expect(later.purchase?.id).toBe(created.purchase?.id);
    expect(later.purchase?.saleValue).toBe(200);
    expect(later.purchase?.updatedAt).toBeGreaterThan(created.purchase?.updatedAt ?? 0);
    expect(purchaseStore.size).toBe(1);
  });
});
