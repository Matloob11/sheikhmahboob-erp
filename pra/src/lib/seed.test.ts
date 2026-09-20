import { describe, expect, it } from "vitest";
import { emptyDeskSettings, shouldSeedDemoClient } from "./seed";

describe("first-run empty desk", () => {
  it("does not auto-create Demo Traders on a hosted production build", () => {
    expect(shouldSeedDemoClient(true)).toBe(false);
    const settings = emptyDeskSettings(new Date(2026, 8, 16));
    expect(settings.selectedClientId).toBeUndefined();
    expect(settings.workingPeriod).toBe("2026-09");
    expect(settings.firmName).toBe("My practice");
  });

  it("keeps the sandbox demo seed for local development", () => {
    expect(shouldSeedDemoClient(false)).toBe(true);
  });
});
