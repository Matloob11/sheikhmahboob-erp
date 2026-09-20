import { describe, expect, it } from "vitest";
import { dueInstants } from "../lib/ids";
import { dueNotifyCandidates, markDueNotifyFired, shouldFireDueNotify } from "./dueNotify";
import { memoryStore } from "./reminders";

describe("due notify calendar", () => {
  it("uses the 15th and 18th after period 2026-09", () => {
    const dues = dueInstants("2026-09");
    expect(dues.payment.getFullYear()).toBe(2026);
    expect(dues.payment.getMonth()).toBe(9);
    expect(dues.payment.getDate()).toBe(15);
    expect(dues.returnDue.getDate()).toBe(18);
    expect(dues.returnDue.getMonth()).toBe(9);
  });

  it("lists payment on 15 Oct and both dues on 18 Oct", () => {
    const paymentDay = dueNotifyCandidates("2026-09", new Date(2026, 9, 15));
    expect(paymentDay.map((row) => row.kind)).toEqual(["payment"]);
    const returnDay = dueNotifyCandidates("2026-09", new Date(2026, 9, 18));
    expect(returnDay.map((row) => row.kind)).toEqual(["payment", "return"]);
    expect(dueNotifyCandidates("2026-09", new Date(2026, 9, 10))).toEqual([]);
  });

  it("does not fire the same due key twice", () => {
    const store = memoryStore();
    const now = new Date(2026, 9, 15);
    expect(shouldFireDueNotify("2026-09", now, store)).toBe(true);
    markDueNotifyFired("2026-09", now, store);
    expect(shouldFireDueNotify("2026-09", now, store)).toBe(false);
  });
});
