import { describe, expect, it } from "vitest";
import { emptyListCopy, masterShowsForm, resolveMasterPane } from "./masterPane";

describe("resolveMasterPane", () => {
  it("keeps the detail closed until the user picks a row", () => {
    expect(resolveMasterPane(["cli_a", "cli_b"], null, false)).toEqual({ kind: "closed" });
    expect(resolveMasterPane([], null, false)).toEqual({ kind: "closed" });
  });

  it("opens new only when the user asks to create", () => {
    expect(resolveMasterPane(["cli_1"], "cli_1", true)).toEqual({ kind: "new" });
    expect(resolveMasterPane([], null, true)).toEqual({ kind: "new" });
  });

  it("edits the row the user selected", () => {
    expect(resolveMasterPane(["cli_a", "cli_b"], "cli_b", false)).toEqual({
      kind: "edit",
      id: "cli_b",
    });
  });

  it("closes again when the selected row disappears", () => {
    expect(resolveMasterPane(["cli_a", "cli_b"], "gone", false)).toEqual({ kind: "closed" });
  });
});

describe("masterShowsForm", () => {
  it("shows the form only for new or edit", () => {
    expect(masterShowsForm({ kind: "closed" })).toBe(false);
    expect(masterShowsForm({ kind: "new" })).toBe(true);
    expect(masterShowsForm({ kind: "edit", id: "cli_a" })).toBe(true);
  });
});

describe("emptyListCopy", () => {
  it("does not blame a search when the list is simply empty", () => {
    expect(emptyListCopy(false, "clients")).toBe("No clients yet.");
    expect(emptyListCopy(true, "clients")).toBe("No clients match that search.");
  });
});
