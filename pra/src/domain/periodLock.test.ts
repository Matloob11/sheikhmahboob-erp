import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReturnPeriod } from "../types";

const { stores } = vi.hoisted(() => {
  const returns = new Map<string, ReturnPeriod>();
  return { stores: { returns } };
});

vi.mock("../hooks/useLive", () => ({ notifyDb: () => undefined }));
vi.mock("./events", () => ({ logEvent: async () => undefined }));
vi.mock("../db", () => ({
  db: {
    returns: {
      put: async (row: ReturnPeriod) => {
        stores.returns.set(row.id, row);
      },
      where: (index: string) => ({
        equals: (key: string | [string, string]) => ({
          toArray: async () => {
            const rows = [...stores.returns.values()];
            if (index === "clientId" && typeof key === "string") {
              return rows.filter((row) => row.clientId === key);
            }
            if (index === "[clientId+period]" && Array.isArray(key)) {
              return rows.filter((row) => row.clientId === key[0] && row.period === key[1]);
            }
            return rows;
          },
        }),
      }),
    },
  },
}));

import { assertPeriodUnlocked, isPeriodLocked, unlockPeriod } from "./periodLock";

beforeEach(() => {
  stores.returns.clear();
});

describe("period lock", () => {
  it("locks when the return is filed", async () => {
    stores.returns.set("ret_1", {
      id: "ret_1",
      clientId: "cli_1",
      period: "2026-09",
      status: "filed",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await isPeriodLocked("cli_1", "2026-09")).toBe(true);
    await expect(assertPeriodUnlocked("cli_1", "2026-09-14 10:00:00")).rejects.toThrow(/locked/i);
  });

  it("unlocks filed back to ready", async () => {
    stores.returns.set("ret_1", {
      id: "ret_1",
      clientId: "cli_1",
      period: "2026-09",
      status: "filed",
      filedAt: 10,
      irisAck: "ok",
      createdAt: 1,
      updatedAt: 1,
    });
    await unlockPeriod("cli_1", "2026-09");
    expect(stores.returns.get("ret_1")?.status).toBe("ready");
    expect(await isPeriodLocked("cli_1", "2026-09")).toBe(false);
  });
});
