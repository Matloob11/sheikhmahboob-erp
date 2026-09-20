import { describe, expect, it } from "vitest";
import { mergeClient, mergeInvoice } from "../src/sync/merge.js";

describe("mergeClient", () => {
  it("takes remote when newer", () => {
    const decision = mergeClient(
      { id: "c1", businessName: "Old", posToken: "tok", updatedAt: 1 },
      { id: "c1", businessName: "New", posToken: "tok2", updatedAt: 2 },
    );
    expect(decision.action).toBe("take_remote");
    if (decision.action !== "keep_local") {
      expect(decision.merged.businessName).toBe("New");
      expect(decision.merged.posToken).toBe("tok2");
    }
  });

  it("never blanks a local token with empty remote", () => {
    const decision = mergeClient(
      { id: "c1", posToken: "keep-me", updatedAt: 1 },
      { id: "c1", posToken: "", businessName: "X", updatedAt: 2 },
    );
    expect(decision.action).toBe("take_remote");
    if (decision.action !== "keep_local") {
      expect(decision.merged.posToken).toBe("keep-me");
      expect(decision.merged.businessName).toBe("X");
    }
  });

  it("keeps local when local is newer", () => {
    const decision = mergeClient(
      { id: "c1", businessName: "Local", updatedAt: 5 },
      { id: "c1", businessName: "Remote", updatedAt: 2 },
    );
    expect(decision).toEqual({ action: "keep_local", reason: "local_newer" });
  });
});

describe("mergeInvoice", () => {
  it("never downgrades posted to draft", () => {
    const decision = mergeInvoice(
      { id: "i1", status: "posted", updatedAt: 1, fiscalNumber: "F1" },
      { id: "i1", status: "draft", updatedAt: 99 },
    );
    expect(decision).toEqual({ action: "keep_local", reason: "never_downgrade_posted" });
  });

  it("takes newer remote when not downgrading posted", () => {
    const decision = mergeInvoice(
      { id: "i1", status: "draft", updatedAt: 1, buyerName: "A" },
      { id: "i1", status: "validated", updatedAt: 2, buyerName: "B" },
    );
    expect(decision.action).toBe("take_remote");
    if (decision.action !== "keep_local") {
      expect(decision.merged.status).toBe("validated");
      expect(decision.merged.buyerName).toBe("B");
    }
  });
});
