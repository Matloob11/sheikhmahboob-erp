import { digitsOnly } from "../lib/ids";
import { PRA_SANDBOX_TOKEN, type Client, type PsidStatus } from "../types";

export function isPntn(value: string): boolean {
  return /^\d{7}-\d$/.test(value.trim());
}

export function isCnic(value: string): boolean {
  return digitsOnly(value).length === 13;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validateClient(client: Pick<
  Client,
  "businessName" | "pntn" | "cnic" | "email" | "posId" | "posToken" | "environment" | "postingMode"
>): string[] {
  const errors: string[] = [];
  if (!client.businessName.trim()) errors.push("Business name is required.");
  if (client.pntn.trim() && !isPntn(client.pntn)) {
    errors.push("PNTN should look like 1234567-8.");
  }
  if (client.cnic.trim() && !isCnic(client.cnic)) {
    errors.push("CNIC must be 13 digits if provided.");
  }
  if (client.email.trim() && !isEmail(client.email)) {
    errors.push("Email address is not valid.");
  }
  if (client.posId.trim() && !Number(digitsOnly(client.posId))) {
    errors.push("POS ID must be numeric.");
  }
  const token = client.posToken.trim();
  const serverPosting = client.postingMode === "server";
  if (token.toLowerCase().startsWith("bearer ")) {
    errors.push("Paste the eIMS token only — the app adds the Bearer header.");
  }
  if (client.environment === "production" && !token && !serverPosting) {
    errors.push("Production files need an eIMS token from PRA IRIS.");
  }
  if (client.environment === "production" && token && token === PRA_SANDBOX_TOKEN) {
    errors.push("Production files cannot use the published sandbox token.");
  }
  return errors;
}

export function validatePurchaseDraft(input: {
  supplierName: string;
  supplierPntn: string;
  invoiceNo: string;
  saleValue: number;
  taxRate: number;
}): string[] {
  const errors: string[] = [];
  if (!input.supplierName.trim()) errors.push("Supplier name is required.");
  if (input.supplierPntn.trim() && !isPntn(input.supplierPntn)) {
    errors.push("Supplier PNTN should look like 1234567-8.");
  }
  if (!input.invoiceNo.trim()) errors.push("Purchase invoice number is required.");
  if (input.saleValue <= 0) errors.push("Sale value must be greater than 0.");
  if (input.taxRate < 0 || input.taxRate > 100) errors.push("Tax rate must be between 0 and 100.");
  return errors;
}

export function validatePsidDraft(input: {
  period: string;
  amount: number;
  status: PsidStatus;
  psid: string;
}): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}$/.test(input.period)) errors.push("Period must be YYYY-MM.");
  if (input.amount < 0) errors.push("Amount cannot be negative.");
  if ((input.status === "generated" || input.status === "paid" || input.status === "claimed") && !input.psid.trim()) {
    errors.push("Paste the PSID from PRA IRIS before marking it generated or paid.");
  }
  if ((input.status === "paid" || input.status === "claimed") && input.amount <= 0) {
    errors.push("Paid rows need an amount.");
  }
  return errors;
}

export function hasRegistrationNo(
  client: Pick<Client, "pntn" | "cnic" | "cnicAsRegistration">,
): boolean {
  if (client.pntn.trim()) return true;
  return client.cnicAsRegistration === true && isCnic(client.cnic);
}

export function clientReadiness(client: Client): string[] {
  const notes: string[] = [];
  if (!hasRegistrationNo(client)) notes.push("PNTN missing");
  if (!client.posId.trim()) notes.push("POS ID missing");
  if (!client.posToken.trim()) notes.push("eIMS token missing");
  if (client.environment === "production" && !client.posToken.trim()) {
    notes.push("Cannot post live");
  }
  if (client.environment === "production" && client.posToken.trim() === PRA_SANDBOX_TOKEN) {
    notes.push("Sandbox token on a production file");
  }
  return notes;
}

