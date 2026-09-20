import { describe, expect, it } from "vitest";
import { cabinetWarning } from "./cabinet";

describe("cabinetWarning", () => {
  it("warns hosted users that another browser is empty", () => {
    expect(cabinetWarning(true)).toContain("Import a backup");
    expect(cabinetWarning(false)).toBe("Client files stay on this computer.");
  });
});
