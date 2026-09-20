import { calendarDaysUntil, dueInstants, inPeriod } from "../lib/ids";
import { money } from "../lib/money";
import { paidAmountFor } from "./psids";
import { clientReadiness } from "./validate";
import type { Client, Invoice, PsidRecord, Purchase, ReturnPeriod } from "../types";

export function isProductionPosted(
  invoice: Pick<Invoice, "status" | "postedEnvironment">,
): boolean {
  return invoice.status === "posted" && invoice.postedEnvironment !== "sandbox";
}

export function postedSalesInPeriod(
  invoices: ReadonlyArray<Invoice>,
  clientId: string,
  period: string,
): Invoice[] {
  return invoices.filter(
    (row) =>
      row.clientId === clientId &&
      isProductionPosted(row) &&
      inPeriod(row.dateTime, period),
  );
}

/** Credit notes (type 3) reduce output; sales and debit notes stay positive. */
export function invoiceAmountSign(invoice: Pick<Invoice, "invoiceType">): 1 | -1 {
  return invoice.invoiceType === 3 ? -1 : 1;
}

export function signedInvoiceAmount(
  invoice: Pick<Invoice, "invoiceType">,
  amount: number,
): number {
  return money(amount * invoiceAmountSign(invoice));
}

export function purchasesInPeriod(
  purchases: ReadonlyArray<Purchase>,
  clientId: string,
  period: string,
): Purchase[] {
  return purchases.filter((row) => row.clientId === clientId && row.period === period);
}

export function psidsInPeriod(
  psids: ReadonlyArray<PsidRecord>,
  clientId: string,
  period: string,
): PsidRecord[] {
  return psids.filter((row) => row.clientId === clientId && row.period === period);
}

export function isBlockedCredit(row: Purchase): boolean {
  return row.blockedCredit === true;
}

export function purchaseCredit(purchases: ReadonlyArray<Purchase>): {
  adjustable: number;
  blocked: number;
} {
  let adjustable = 0;
  let blocked = 0;
  for (const row of purchases) {
    if (isBlockedCredit(row)) blocked += row.taxCharged;
    else adjustable += row.taxCharged;
  }
  return { adjustable: money(adjustable), blocked: money(blocked) };
}

export function psidCoverNote(input: { netPayable: number; psidPaid: number }): string | undefined {
  if (money(input.psidPaid) === money(input.netPayable)) return undefined;
  return "Paid + claimed does not match net payable. Create the official PSID on PRA IRIS — this desk will not invent one.";
}

export interface FileLedger {
  sales: Invoice[];
  purchases: Purchase[];
  psids: PsidRecord[];
  saleCount: number;
  saleValue: number;
  outputTax: number;
  inputTax: number;
  blockedInputTax: number;
  netPayable: number;
  psidPaid: number;
  psidGap: number;
  psidMismatch: boolean;
  unpaidPsids: number;
  failedInvoices: number;
  draftInvoices: number;
  daysToPayment: number;
  daysToReturn: number;
  paymentDue: Date;
  returnDue: Date;
}

export function computeFileLedger(input: {
  clientId: string;
  period: string;
  invoices: ReadonlyArray<Invoice>;
  purchases: ReadonlyArray<Purchase>;
  psids: ReadonlyArray<PsidRecord>;
  now?: Date;
}): FileLedger {
  const sales = postedSalesInPeriod(input.invoices, input.clientId, input.period);
  const purchases = purchasesInPeriod(input.purchases, input.clientId, input.period);
  const psids = psidsInPeriod(input.psids, input.clientId, input.period);
  const outputTax = money(
    sales.reduce((sum, row) => sum + signedInvoiceAmount(row, row.totalTaxCharged), 0),
  );
  const credit = purchaseCredit(purchases);
  const inputTax = credit.adjustable;
  const saleValue = money(
    sales.reduce((sum, row) => sum + signedInvoiceAmount(row, row.totalSaleValue), 0),
  );
  const netPayable = money(outputTax - inputTax);
  const psidPaid = money(
    psids
      .filter((row) => row.status === "paid" || row.status === "claimed")
      .reduce((sum, row) => sum + paidAmountFor(row), 0),
  );
  const dues = dueInstants(input.period);
  const now = input.now ?? new Date();
  const inThisFile = (row: Invoice) =>
    row.clientId === input.clientId && inPeriod(row.dateTime, input.period);
  const failedInvoices = input.invoices.filter((row) => inThisFile(row) && row.status === "failed").length;
  const draftInvoices = input.invoices.filter(
    (row) => inThisFile(row) && (row.status === "draft" || row.status === "validated"),
  ).length;
  return {
    sales,
    purchases,
    psids,
    saleCount: sales.length,
    saleValue,
    outputTax,
    inputTax,
    blockedInputTax: credit.blocked,
    netPayable,
    psidPaid,
    psidGap: money(netPayable - psidPaid),
    psidMismatch: money(netPayable) !== money(psidPaid),
    unpaidPsids: psids.filter((row) => row.status !== "paid" && row.status !== "claimed").length,
    failedInvoices,
    draftInvoices,
    daysToPayment: calendarDaysUntil(dues.payment, now),
    daysToReturn: calendarDaysUntil(dues.returnDue, now),
    paymentDue: dues.payment,
    returnDue: dues.returnDue,
  };
}

export interface ClientAttention {
  client: Client;
  reasons: string[];
}

export type AttentionSeverity = "high" | "medium" | "low";

export function attentionJump(reason: string): { severity: AttentionSeverity; path: string; label: string } {
  const text = reason.toLowerCase();
  if (text.includes("failed")) return { severity: "high", path: "/invoices", label: "Open invoices" };
  if (text.includes("psid")) return { severity: "high", path: "/psid", label: "Record PSID" };
  if (text.includes("pos") || text.includes("token") || text.includes("cannot post")) {
    return { severity: "medium", path: "/clients", label: "Open client" };
  }
  return { severity: "low", path: "/clients", label: "Open client" };
}

export function worstAttentionSeverity(reasons: string[]): AttentionSeverity {
  const rank = { high: 3, medium: 2, low: 1 };
  return reasons.reduce<AttentionSeverity>((worst, reason) => {
    const next = attentionJump(reason).severity;
    return rank[next] > rank[worst] ? next : worst;
  }, "low");
}

export function practiceAttention(input: {
  clients: ReadonlyArray<Client>;
  invoices: ReadonlyArray<Invoice>;
  psids: ReadonlyArray<PsidRecord>;
  period: string;
}): ClientAttention[] {
  return input.clients
    .map((client) => {
      const reasons = clientReadiness(client);
      const failed = input.invoices.filter((row) => row.clientId === client.id && row.status === "failed").length;
      if (failed) reasons.push(`${failed} failed eIMS post${failed === 1 ? "" : "s"}`);
      const unpaid = input.psids.filter(
        (row) =>
          row.clientId === client.id &&
          row.period === input.period &&
          row.status !== "paid" &&
          row.status !== "claimed",
      ).length;
      if (unpaid) reasons.push(`${unpaid} unpaid PSID row${unpaid === 1 ? "" : "s"}`);
      return { client, reasons };
    })
    .filter((row) => row.reasons.length > 0);
}

export function returnForPeriod(
  returns: ReadonlyArray<ReturnPeriod>,
  clientId: string,
  period: string,
): ReturnPeriod | undefined {
  const matches = returns.filter((row) => row.clientId === clientId && row.period === period);
  if (matches.length === 0) return undefined;
  return matches.reduce((latest, row) => (row.updatedAt >= latest.updatedAt ? row : latest));
}
