import { describe, expect, it } from "vitest";
import {
  calendarDaysUntil,
  currentPeriod,
  dueInstants,
  filingPeriod,
  inPeriod,
  invoicePeriod,
  isLegacyShortId,
  newId,
  nextUsin,
  periodStamp,
} from "./ids";

describe("newId", () => {
  it("uses a full UUID so collisions are not a 32-bit coin flip", () => {
    const id = newId("inv");
    expect(id).toMatch(
      /^inv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(new Set(Array.from({ length: 40 }, () => newId("inv"))).size).toBe(40);
  });

  it("still recognises short ids already stored in the desk", () => {
    expect(isLegacyShortId("inv_a1b2c3d4")).toBe(true);
    expect(isLegacyShortId("cli_deadbeef")).toBe(true);
    expect(isLegacyShortId(newId("inv"))).toBe(false);
  });
});

describe("period helpers", () => {
  it("reads YYYY-MM from an invoice stamp", () => {
    expect(invoicePeriod("2026-09-14 10:00:00")).toBe("2026-09");
    expect(inPeriod("2026-09-14 10:00:00", "2026-09")).toBe(true);
    expect(inPeriod("2026-08-14 10:00:00", "2026-09")).toBe(false);
  });

  it("stamps a past working month on its last day", () => {
    const now = new Date(2026, 8, 15, 10, 30, 0);
    const stamp = periodStamp("2026-08", now);
    expect(stamp.getFullYear()).toBe(2026);
    expect(stamp.getMonth()).toBe(7);
    expect(stamp.getDate()).toBe(31);
    expect(periodStamp("2026-09", now).getTime()).toBe(now.getTime());
  });

  it("builds a USIN from the working-month stamp", () => {
    const stamp = new Date("2026-08-31T07:00:00.000Z");
    expect(nextUsin("1234567-8", [], stamp)).toBe("DFT-1234567-20260831-001");
    expect(nextUsin("1234567-8", ["DFT-1234567-20260831-001"], stamp)).toBe("DFT-1234567-20260831-002");
  });

  it("uses the 15th for payment and the 18th for the return", () => {
    const september = dueInstants("2026-09");
    expect(september.payment.getFullYear()).toBe(2026);
    expect(september.payment.getMonth()).toBe(9);
    expect(september.payment.getDate()).toBe(15);
    expect(september.returnDue.getMonth()).toBe(9);
    expect(september.returnDue.getDate()).toBe(18);
    const january = dueInstants("2026-01");
    expect(january.payment.getMonth()).toBe(1);
    expect(january.payment.getDate()).toBe(15);
    expect(january.returnDue.getDate()).toBe(18);
  });

  it("uses Karachi date on a USIN when UTC is still yesterday", () => {
    const stamp = new Date("2026-08-31T22:00:00.000Z");
    expect(nextUsin("1234567-8", [], stamp)).toBe("DFT-1234567-20260901-001");
    expect(currentPeriod(stamp)).toBe("2026-09");
    expect(filingPeriod(stamp)).toBe("2026-08");
  });

  it("counts calendar days", () => {
    const now = new Date(2026, 8, 14);
    expect(calendarDaysUntil(new Date(2026, 8, 15), now)).toBe(1);
    expect(calendarDaysUntil(new Date(2026, 8, 14), now)).toBe(0);
    expect(calendarDaysUntil(new Date(2026, 8, 13), now)).toBe(-1);
  });
});
