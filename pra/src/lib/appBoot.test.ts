import { describe, expect, it, vi } from "vitest";
import { bootDesk } from "./appBoot";

describe("bootDesk", () => {
  it("reports ready when seed succeeds", async () => {
    const outcome = await bootDesk(async () => undefined);
    expect(outcome).toEqual({ ok: true });
  });

  it("surfaces a plain error instead of hanging forever", async () => {
    const outcome = await bootDesk(async () => {
      throw new Error("IndexedDB blocked");
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("IndexedDB blocked");
  });

  it("uses a fallback message for non-Error throws", async () => {
    const seed = vi.fn(async () => {
      throw "boom";
    });
    const outcome = await bootDesk(seed);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message.length).toBeGreaterThan(0);
  });
});
