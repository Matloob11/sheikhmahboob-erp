import { pkr } from "./money";
import type { Client, Invoice } from "../types";

export function invoiceShareText(invoice: Invoice, client: Client): string {
  const lines = [
    client.businessName,
    `USIN ${invoice.usin}`,
    invoice.fiscalNumber ? `Fiscal ${invoice.fiscalNumber}` : "Fiscal pending",
    invoice.buyerName ? `Buyer ${invoice.buyerName}` : "Walk-in",
    `Bill ${pkr(invoice.totalBillAmount)}`,
    invoice.dateTime,
  ];
  return lines.join("\n");
}

export function invoiceMailto(invoice: Invoice, client: Client): string {
  const subject = `${client.businessName} · ${invoice.usin}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(invoiceShareText(invoice, client))}`;
}

export function invoiceWhatsApp(invoice: Invoice, client: Client, phone?: string): string {
  const text = encodeURIComponent(invoiceShareText(invoice, client));
  const local = phone?.replace(/\D/g, "") ?? "";
  if (local.length === 11 && local.startsWith("03")) {
    return `https://wa.me/92${local.slice(1)}?text=${text}`;
  }
  return `https://wa.me/?text=${text}`;
}
