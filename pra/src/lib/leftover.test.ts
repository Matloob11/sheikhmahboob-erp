import { describe, expect, it } from "vitest";
import { backupDownloadName } from "./backup";
import { fiscalYearLabel } from "./fiscalYear";
import { isRetryablePraError } from "../domain/invoices";
import { invoiceShareText } from "./shareInvoice";
import type { Client, Invoice } from "../types";

describe("leftover helpers", () => {
  it("names backups on the Karachi civil day", () => {
    expect(backupDownloadName(new Date("2026-09-17T22:00:00.000Z"))).toBe("daftar-backup-2026-09-18.json");
    expect(backupDownloadName(new Date("2026-09-18T05:00:00.000Z"), "cli_1")).toBe("daftar-client-2026-09-18.json");
  });

  it("labels a July fiscal year", () => {
    expect(fiscalYearLabel("2026-09", 7)).toBe("FY 2026-27");
    expect(fiscalYearLabel("2026-06", 7)).toBe("FY 2025-26");
  });

  it("retries only transport-looking PRA errors", () => {
    expect(isRetryablePraError("Failed to fetch")).toBe(true);
    expect(isRetryablePraError("502 Bad Gateway")).toBe(true);
    expect(isRetryablePraError("Invalid token")).toBe(false);
  });

  it("builds a share text without tokens", () => {
    const text = invoiceShareText(
      { usin: "DFT-1", fiscalNumber: "9", buyerName: "A", totalBillAmount: 10, dateTime: "2026-09-18 10:00:00" } as Invoice,
      { businessName: "Demo" } as Client,
    );
    expect(text).toContain("DFT-1");
    expect(text).not.toMatch(/token|Bearer/i);
  });
});
