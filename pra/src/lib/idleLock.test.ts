import { describe, expect, it } from "vitest";
import {
  DEFAULT_IDLE_MINUTES,
  idleShouldLock,
  readIdleMinutes,
  readLastActivity,
  recordDeskActivity,
  writeIdleMinutes,
} from "./idleLock";

describe("idleShouldLock", () => {
  it("locks after N minutes", () => {
    expect(idleShouldLock(1_000, 1_000 + 15 * 60_000, 15)).toBe(true);
    expect(idleShouldLock(1_000, 1_000 + 14 * 60_000, 15)).toBe(false);
  });

  it("never locks when minutes is 0", () => {
    expect(idleShouldLock(1, 1_000_000_000, 0)).toBe(false);
  });

  it("resets when activity moves forward", () => {
    const start = 10_000;
    expect(idleShouldLock(start, start + 20 * 60_000, 15)).toBe(true);
    expect(idleShouldLock(start + 19 * 60_000, start + 20 * 60_000, 15)).toBe(false);
  });
});

describe("idle storage helpers", () => {
  it("reads a default and writes minutes", () => {
    const local = new Map<string, string>();
    const store = {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => {
        local.set(key, value);
      },
    };
    expect(readIdleMinutes(store)).toBe(DEFAULT_IDLE_MINUTES);
    writeIdleMinutes(5, store);
    expect(readIdleMinutes(store)).toBe(5);
  });

  it("records last activity", () => {
    const session = new Map<string, string>();
    const store = {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => {
        session.set(key, value);
      },
    };
    recordDeskActivity(42, store);
    expect(readLastActivity(99, store)).toBe(42);
  });
});
