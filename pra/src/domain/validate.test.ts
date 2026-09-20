import { describe, expect, it } from "vitest";
import { PRA_SANDBOX_TOKEN, type Client } from "../types";
import { clientReadiness, isPntn, validateClient, validatePsidDraft, validatePurchaseDraft } from "./validate";

describe("validate", () => {
  it("accepts Punjab NTN shape", () => {
    expect(isPntn("1234567-8")).toBe(true);
    expect(isPntn("12345678")).toBe(false);
  });

  it("requires a business name and a production token", () => {
    const errors = validateClient({
      businessName: "",
      pntn: "bad",
      cnic: "123",
      email: "not-an-email",
      posId: "abc",
      posToken: "",
      environment: "production",
    });
    expect(errors.length).toBeGreaterThan(3);
  });

  it("rejects empty purchases", () => {
    const errors = validatePurchaseDraft({
      supplierName: "",
      supplierPntn: "1234567-8",
      invoiceNo: "",
      saleValue: 0,
      taxRate: 16,
    });
    expect(errors).toContain("Supplier name is required.");
  });

  it("rejects the published sandbox token on a production file", () => {
    const errors = validateClient({
      businessName: "Live Co",
      pntn: "1234567-8",
      cnic: "",
      email: "",
      posId: "100000",
      posToken: PRA_SANDBOX_TOKEN,
      environment: "production",
    });
    expect(errors.some((error) => /sandbox token/i.test(error))).toBe(true);
    expect(errors.join(" ")).not.toContain(PRA_SANDBOX_TOKEN);
  });

  it("rejects a Bearer prefix on the token field", () => {
    const errors = validateClient({
      businessName: "Live Co",
      pntn: "1234567-8",
      cnic: "",
      email: "",
      posId: "100000",
      posToken: "Bearer abc",
      environment: "sandbox",
    });
    expect(errors[0]).toMatch(/token only/i);
    expect(errors.join(" ")).not.toMatch(/Bearer abc/);
  });

  it("flags a published sandbox token on a production file in readiness", () => {
    const client: Client = {
      id: "cli_1",
      businessName: "Live Co",
      brandName: "",
      pntn: "1234567-8",
      cnic: "",
      phone: "",
      email: "",
      address: "",
      city: "",
      sector: "Consultancy",
      branchName: "",
      posId: "100000",
      posToken: PRA_SANDBOX_TOKEN,
      environment: "production",
      notes: "",
      createdAt: 1,
      updatedAt: 1,
    };
    const notes = clientReadiness(client);
    expect(notes).toContain("Sandbox token on a production file");
    expect(notes.join(" ")).not.toContain(PRA_SANDBOX_TOKEN);
  });

  it("does not flag PNTN missing when CNIC is the registration number", () => {
    const notes = clientReadiness({
      id: "cli_1",
      businessName: "Ahmad",
      brandName: "",
      pntn: "",
      cnic: "3630264674703",
      phone: "",
      email: "",
      address: "",
      city: "",
      sector: "Consultancy",
      branchName: "",
      posId: "100000",
      posToken: "token",
      environment: "sandbox",
      notes: "",
      cnicAsRegistration: true,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(notes).not.toContain("PNTN missing");
  });

  it("requires a PSID once the row is generated", () => {
    const errors = validatePsidDraft({
      period: "2026-09",
      amount: 1280,
      status: "paid",
      psid: "",
    });
    expect(errors[0]).toMatch(/PSID/);
  });
});
