import { describe, expect, it } from "vitest";
import { formatDateTime, formatDay, karachiStamp } from "./format";

describe("Karachi civil clock", () => {
  it("prints Punjab time, not the laptop timezone", () => {
    const utc = new Date("2026-09-18T00:30:00.000Z");
    expect(formatDateTime(utc)).toBe("2026-09-18 05:30:00");
    expect(formatDay(utc)).toBe("2026-09-18");
  });

  it("rolls the tax date at midnight in Karachi", () => {
    const before = new Date("2026-09-17T18:59:59.000Z");
    const after = new Date("2026-09-17T19:00:00.000Z");
    expect(formatDay(before)).toBe("2026-09-17");
    expect(formatDay(after)).toBe("2026-09-18");
    expect(karachiStamp(after)).toMatchObject({ year: 2026, month: 9, day: 18, hour: 0, minute: 0, second: 0 });
  });
});
