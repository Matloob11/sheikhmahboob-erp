import { describe, expect, it } from "vitest";
import type { Client, Invoice } from "../types";
import { printBanner, sellerPrintLines } from "./print";

const base: Client = {
  id: "cli_1",
  businessName: "Khan Advisory",
  brandName: "",
  pntn: "",
  cnic: "3520212345671",
  phone: "",
  email: "",
  address: "Jail Road",
  city: "Lahore",
  sector: "Consultancy",
  branchName: "Head office",
  posId: "100001",
  posToken: "token",
  environment: "production",
  notes: "",
  personName: "IFTIKHAR AHMAD",
  cnicAsRegistration: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("sellerPrintLines", () => {
  it("uses Registration (CNIC) when the CNIC is the registration", () => {
    const lines = sellerPrintLines(base, "Khan & Co.");
    expect(lines.firmName).toBe("Khan & Co.");
    expect(lines.personName).toBe("IFTIKHAR AHMAD");
    expect(lines.pntnLabel).toBe("Registration (CNIC)");
    expect(lines.pntnValue).toBe("3520212345671");
    expect(lines.cnicValue).toBe("3520212345671");
  });

  it("keeps PNTN when present", () => {
    const lines = sellerPrintLines({ ...base, pntn: "1234567-8" });
    expect(lines.pntnLabel).toBe("Seller PNTN");
    expect(lines.pntnValue).toBe("1234567-8");
  });
});

describe("printBanner", () => {
  it("marks draft vs posted vs failed", () => {
    const draft = { status: "draft", fiscalNumber: "" } as Invoice;
    const posted = { status: "posted", fiscalNumber: "9001" } as Invoice;
    const failed = { status: "failed", fiscalNumber: "" } as Invoice;
    expect(printBanner(draft)).toEqual({ tone: "draft", label: "Draft" });
    expect(printBanner(posted)).toEqual({ tone: "posted", label: "Posted · 9001" });
    expect(printBanner(failed)).toEqual({ tone: "failed", label: "Not accepted by PRA" });
  });
});
