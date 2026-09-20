import { describe, expect, it } from "vitest";
import { sanitizeActivityRows } from "./activity";

describe("sanitizeActivityRows", () => {
  it("redacts token-like detail", () => {
    const rows = sanitizeActivityRows([
      {
        id: "ev_1",
        kind: "client.saved",
        title: "Updated file",
        detail: "Authorization: Bearer 24d8fab3-f2e9-398f-ae17-b387125ec4a2-extra-secret",
        createdAt: Date.UTC(2026, 8, 14, 10, 0, 0),
        clientId: "cli_1",
      },
      {
        id: "ev_2",
        kind: "invoice.posted",
        title: "Posted DFT-1",
        detail: "posToken abcdefghijklmnopqrstuvwxyz0123456789ABCD==",
        createdAt: Date.UTC(2026, 8, 14, 11, 0, 0),
      },
    ]);
    expect(rows[0]?.detail).toContain("[redacted]");
    expect(rows[0]?.detail.toLowerCase()).not.toContain("bearer");
    expect(rows[1]?.detail).toContain("[redacted]");
    expect(rows[1]?.detail).not.toContain("posToken");
  });
});
