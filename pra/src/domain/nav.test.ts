import { describe, expect, it } from "vitest";
import { sectionPath } from "./nav";

describe("sectionPath", () => {
  it("keeps local root paths", () => {
    expect(sectionPath("/invoices", "/", "/")).toBe("/invoices");
    expect(sectionPath("/", "/", "/")).toBe("/");
  });

  it("prefixes /pra when the hosted app is under /pra without Vite base", () => {
    expect(sectionPath("/invoices", "/pra/", "/")).toBe("/pra/invoices");
    expect(sectionPath("/", "/pra/invoices", "/")).toBe("/pra");
  });

  it("does not double-prefix when Vite base is already /pra", () => {
    expect(sectionPath("/invoices", "/invoices", "/pra/")).toBe("/invoices");
    expect(sectionPath("/", "/", "/pra/")).toBe("/");
  });
});
