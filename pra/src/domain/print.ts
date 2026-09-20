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
    if (invoice.postedEnvironment === "sandbox") {
      return {
        tone: "posted",
        label: invoice.fiscalNumber
          ? `SANDBOX — test only · ${invoice.fiscalNumber}`
          : "SANDBOX — test only",
      };
    }
    return {
      tone: "posted",
      label: invoice.fiscalNumber
        ? `Posted · fiscal ${invoice.fiscalNumber}`
        : "Posted",
    };
  }
  if (invoice.status === "unknown") {
    return { tone: "failed", label: "DRAFT — not a tax invoice · unclear PRA result" };
  }
  if (invoice.status === "failed") {
    return { tone: "failed", label: "DRAFT — not a tax invoice · not accepted by PRA" };
  }
  if (invoice.status === "validated") {
    return { tone: "draft", label: "DRAFT — not a tax invoice · validated only" };
  }
  return { tone: "draft", label: "DRAFT — not a tax invoice" };
}
