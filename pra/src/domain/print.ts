import { digitsOnly } from "../lib/ids";
import type { Client, Invoice } from "../types";

export interface SellerPrintLines {
  firmName: string;
  businessName: string;
  personName: string;
  pntnLabel: string;
  pntnValue: string;
  cnicLabel: string;
  cnicValue: string;
  place: string;
}

export interface PrintBanner {
  tone: "draft" | "posted" | "failed";
  label: string;
}

export function sellerPrintLines(client: Client, firmName = ""): SellerPrintLines {
  const cnic = client.cnic.trim();
  const pntn = client.pntn.trim();
  const cnicAsReg = client.cnicAsRegistration === true && digitsOnly(cnic).length === 13;
  return {
    firmName: firmName.trim(),
    businessName: client.businessName,
    personName: client.personName?.trim() ?? "",
    pntnLabel: cnicAsReg && !pntn ? "Registration (CNIC)" : "Seller PNTN",
    pntnValue: pntn || (cnicAsReg ? cnic : "—"),
    cnicLabel: "Seller CNIC",
    cnicValue: cnic || "—",
    place: [client.address, client.city, client.branchName].filter(Boolean).join(" · "),
  };
}

export function printBanner(invoice: Invoice): PrintBanner {
  if (invoice.status === "posted") {
    const env =
      invoice.postedEnvironment === "sandbox"
        ? "sandbox"
        : invoice.postedEnvironment === "production"
          ? "production"
          : "";
    const envBit = env ? ` · ${env}` : "";
    return {
      tone: "posted",
      label: invoice.fiscalNumber
        ? `Posted${envBit} · ${invoice.fiscalNumber}`
        : `Posted${envBit}`,
    };
  }
  if (invoice.status === "unknown") {
    return { tone: "failed", label: "Unclear — check IRIS before posting again" };
  }
  if (invoice.status === "failed") {
    return { tone: "failed", label: "Not accepted by PRA" };
  }
  if (invoice.status === "validated") {
    return { tone: "draft", label: "Validated — not posted" };
  }
  return { tone: "draft", label: "Draft" };
}
