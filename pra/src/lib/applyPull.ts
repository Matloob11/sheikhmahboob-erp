/**
 * Apply camelCase sync/pull rows into Dexie with newest-wins rules.
 * Server never returns posToken — local token is preserved.
 */
import { db } from "../db";
import type { Buyer, CatalogItem, Client, Invoice, PsidRecord, Purchase, ReturnPeriod } from "../types";

export type SyncConflict = { entity: string; id: string; reason: string };

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isPosted(status: unknown): boolean {
  return status === "posted";
}

/** Merge remote client into local; never blank local posToken. */
export function mergeClientForPull(
  local: Client | undefined,
  remote: Record<string, unknown>,
): { row: Client; conflict?: SyncConflict } {
  const remoteAt = num(remote.updatedAt);
  const localAt = local ? num(local.updatedAt) : 0;
  const base: Client = {
    id: str(remote.id),
    businessName: str(remote.businessName),
    brandName: str(remote.brandName),
    pntn: str(remote.pntn),
    cnic: str(remote.cnic),
    phone: str(remote.phone),
    email: str(remote.email),
    address: str(remote.address),
    city: str(remote.city),
    sector: str(remote.sector),
    branchName: str(remote.branchName),
    posId: str(remote.posId),
    posToken: local?.posToken ?? "",
    environment: (str(remote.environment) || "sandbox") as Client["environment"],
    postingMode: str(remote.postingMode) === "server" ? "server" : "browser",
    notes: str(remote.notes),
    ntn: remote.ntn != null ? str(remote.ntn) : local?.ntn,
    personName: remote.personName != null ? str(remote.personName) : local?.personName,
    personType: (remote.personType != null ? str(remote.personType) : local?.personType) as Client["personType"],
    businessId: remote.businessId != null ? str(remote.businessId) : local?.businessId,
    branchId: remote.branchId != null ? str(remote.branchId) : local?.branchId,
    stStatus: remote.stStatus != null ? str(remote.stStatus) : local?.stStatus,
    registeredOn: remote.registeredOn != null ? str(remote.registeredOn) : local?.registeredOn,
    archived: typeof remote.archived === "boolean" ? remote.archived : local?.archived,
    cnicAsRegistration:
      typeof remote.cnicAsRegistration === "boolean" ? remote.cnicAsRegistration : local?.cnicAsRegistration,
    createdAt: num(remote.createdAt) || local?.createdAt || 0,
    updatedAt: remoteAt || localAt,
  };
  if (local && remoteAt < localAt) {
    return { row: local, conflict: { entity: "client", id: local.id, reason: "local_newer" } };
  }
  if (local && remoteAt === localAt && local.businessName !== base.businessName) {
    return { row: { ...base, posToken: local.posToken }, conflict: { entity: "client", id: base.id, reason: "same_clock_divergence" } };
  }
  return { row: base };
}

export function mergeInvoiceForPull(
  local: Invoice | undefined,
  remote: Record<string, unknown>,
): { row: Invoice; conflict?: SyncConflict } {
  const remoteAt = num(remote.updatedAt);
  const localAt = local ? num(local.updatedAt) : 0;
  if (local && isPosted(local.status) && !isPosted(remote.status)) {
    return { row: local, conflict: { entity: "invoice", id: local.id, reason: "never_downgrade_posted" } };
  }
  if (local && remoteAt < localAt) {
    return { row: local, conflict: { entity: "invoice", id: local.id, reason: "local_newer" } };
  }
  const row: Invoice = {
    id: str(remote.id),
    clientId: str(remote.clientId),
    usin: str(remote.usin),
    invoiceType: (num(remote.invoiceType) || 1) as Invoice["invoiceType"],
    paymentMode: (num(remote.paymentMode) || 1) as Invoice["paymentMode"],
    dateTime: str(remote.dateTime),
    buyerId: remote.buyerId != null ? str(remote.buyerId) : undefined,
    buyerName: str(remote.buyerName),
    buyerPntn: str(remote.buyerPntn),
    buyerCnic: str(remote.buyerCnic),
    buyerPhone: str(remote.buyerPhone),
    discount: num(remote.discount),
    furtherTax: num(remote.furtherTax),
    totalQuantity: num(remote.totalQuantity),
    totalSaleValue: num(remote.totalSaleValue),
    totalTaxCharged: num(remote.totalTaxCharged),
    totalBillAmount: num(remote.totalBillAmount),
    refUsin: str(remote.refUsin),
    items: Array.isArray(remote.items) ? (remote.items as Invoice["items"]) : [],
    status: (str(remote.status) || "draft") as Invoice["status"],
    fiscalNumber: str(remote.fiscalNumber),
    lastError: str(remote.lastError),
    lastResponse: str(remote.lastResponse),
    lastCode: str(remote.lastCode),
    attemptCount: num(remote.attemptCount),
    inFlight: typeof remote.inFlight === "boolean" ? remote.inFlight : undefined,
    inFlightAt: remote.inFlightAt != null ? num(remote.inFlightAt) : undefined,
    postedAt: remote.postedAt != null ? num(remote.postedAt) : undefined,
    postedEnvironment: remote.postedEnvironment != null ? (str(remote.postedEnvironment) as Invoice["postedEnvironment"]) : undefined,
    postedPosId: remote.postedPosId != null ? str(remote.postedPosId) : undefined,
    extraTax: remote.extraTax != null ? num(remote.extraTax) : undefined,
    stWithheld: remote.stWithheld != null ? num(remote.stWithheld) : undefined,
    reverseCharge: typeof remote.reverseCharge === "boolean" ? remote.reverseCharge : undefined,
    saleType: remote.saleType != null ? str(remote.saleType) : undefined,
    taxpayerType: remote.taxpayerType != null ? str(remote.taxpayerType) : undefined,
    buyerDistrict: remote.buyerDistrict != null ? str(remote.buyerDistrict) : undefined,
    createdAt: num(remote.createdAt) || local?.createdAt || 0,
    updatedAt: remoteAt || localAt,
  };
  if (local && isPosted(local.status) && isPosted(remote.status) && remoteAt === localAt && local.fiscalNumber !== row.fiscalNumber) {
    return { row, conflict: { entity: "invoice", id: row.id, reason: "posted_same_clock" } };
  }
  return { row };
}

function asBuyer(remote: Record<string, unknown>): Buyer {
  return {
    id: str(remote.id),
    clientId: str(remote.clientId),
    name: str(remote.name),
    pntn: str(remote.pntn),
    cnic: str(remote.cnic),
    phone: str(remote.phone),
    notes: str(remote.notes),
    address: remote.address != null ? str(remote.address) : undefined,
    district: remote.district != null ? str(remote.district) : undefined,
    email: remote.email != null ? str(remote.email) : undefined,
    buyerType: remote.buyerType != null ? (str(remote.buyerType) as Buyer["buyerType"]) : undefined,
    createdAt: num(remote.createdAt),
    updatedAt: num(remote.updatedAt),
  };
}

function asItem(remote: Record<string, unknown>): CatalogItem {
  return {
    id: str(remote.id),
    clientId: str(remote.clientId),
    itemCode: str(remote.itemCode),
    itemName: str(remote.itemName),
    pctCode: str(remote.pctCode),
    taxRate: num(remote.taxRate),
    unit: remote.unit != null ? str(remote.unit) : undefined,
    defaultQty: remote.defaultQty != null ? num(remote.defaultQty) : undefined,
    inactive: typeof remote.inactive === "boolean" ? remote.inactive : undefined,
    createdAt: num(remote.createdAt),
    updatedAt: num(remote.updatedAt),
  };
}

function asPurchase(remote: Record<string, unknown>): Purchase {
  return {
    id: str(remote.id),
    clientId: str(remote.clientId),
    period: str(remote.period),
    supplierName: str(remote.supplierName),
    supplierPntn: str(remote.supplierPntn),
    invoiceNo: str(remote.invoiceNo),
    invoiceDate: str(remote.invoiceDate),
    saleValue: num(remote.saleValue),
    taxRate: num(remote.taxRate),
    taxCharged: num(remote.taxCharged),
    totalAmount: num(remote.totalAmount),
    notes: str(remote.notes),
    blockedCredit: typeof remote.blockedCredit === "boolean" ? remote.blockedCredit : undefined,
    supplierCnic: remote.supplierCnic != null ? str(remote.supplierCnic) : undefined,
    pctCode: remote.pctCode != null ? str(remote.pctCode) : undefined,
    district: remote.district != null ? str(remote.district) : undefined,
    withheld: remote.withheld != null ? num(remote.withheld) : undefined,
    reverseCharge: typeof remote.reverseCharge === "boolean" ? remote.reverseCharge : undefined,
    createdAt: num(remote.createdAt),
    updatedAt: remote.updatedAt != null ? num(remote.updatedAt) : undefined,
  };
}

function asReturn(remote: Record<string, unknown>): ReturnPeriod {
  return {
    id: str(remote.id),
    clientId: str(remote.clientId),
    period: str(remote.period),
    status: (str(remote.status) || "open") as ReturnPeriod["status"],
    notes: str(remote.notes),
    filedAt: remote.filedAt != null ? num(remote.filedAt) : undefined,
    irisAck: remote.irisAck != null ? str(remote.irisAck) : undefined,
    createdAt: num(remote.createdAt),
    updatedAt: num(remote.updatedAt),
  };
}

function asPsid(remote: Record<string, unknown>): PsidRecord {
  return {
    id: str(remote.id),
    clientId: str(remote.clientId),
    period: str(remote.period),
    amount: num(remote.amount),
    head: str(remote.head),
    psid: str(remote.psid),
    cpr: str(remote.cpr),
    bank: str(remote.bank),
    paidOn: str(remote.paidOn),
    status: (str(remote.status) || "unpaid") as PsidRecord["status"],
    notes: str(remote.notes),
    dueOn: remote.dueOn != null ? str(remote.dueOn) : undefined,
    paidAmount: remote.paidAmount != null ? num(remote.paidAmount) : undefined,
    createdAt: num(remote.createdAt),
    updatedAt: num(remote.updatedAt),
  };
}

export async function applyPullPayload(body: {
  clients: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  buyers: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  purchases: Array<Record<string, unknown>>;
  returns: Array<Record<string, unknown>>;
  psids: Array<Record<string, unknown>>;
}): Promise<{ pulled: number; conflicts: SyncConflict[] }> {
  const conflicts: SyncConflict[] = [];
  let pulled = 0;

  await db.transaction(
    "rw",
    [db.clients, db.invoices, db.buyers, db.items, db.purchases, db.returns, db.psids],
    async () => {
      for (const remote of body.clients) {
        const id = str(remote.id);
        if (!id) continue;
        const local = await db.clients.get(id);
        const { row, conflict } = mergeClientForPull(local, remote);
        if (conflict) conflicts.push(conflict);
        if (!local || num(remote.updatedAt) >= num(local.updatedAt) || conflict?.reason === "same_clock_divergence") {
          if (!(conflict && conflict.reason === "local_newer")) {
            await db.clients.put(row);
            pulled += 1;
          }
        }
      }
      for (const remote of body.invoices) {
        const id = str(remote.id);
        if (!id) continue;
        const local = await db.invoices.get(id);
        const { row, conflict } = mergeInvoiceForPull(local, remote);
        if (conflict) conflicts.push(conflict);
        if (conflict?.reason === "never_downgrade_posted" || conflict?.reason === "local_newer") continue;
        await db.invoices.put(row);
        pulled += 1;
      }
      for (const remote of body.buyers) {
        const row = asBuyer(remote);
        if (!row.id) continue;
        const local = await db.buyers.get(row.id);
        if (local && num(local.updatedAt) > num(row.updatedAt)) continue;
        await db.buyers.put(row);
        pulled += 1;
      }
      for (const remote of body.items) {
        const row = asItem(remote);
        if (!row.id) continue;
        const local = await db.items.get(row.id);
        if (local && num(local.updatedAt) > num(row.updatedAt)) continue;
        await db.items.put(row);
        pulled += 1;
      }
      for (const remote of body.purchases) {
        const row = asPurchase(remote);
        if (!row.id) continue;
        const local = await db.purchases.get(row.id);
        if (local && num(local.updatedAt ?? local.createdAt) > num(row.updatedAt ?? row.createdAt)) continue;
        await db.purchases.put(row);
        pulled += 1;
      }
      for (const remote of body.returns) {
        const row = asReturn(remote);
        if (!row.id) continue;
        const local = await db.returns.get(row.id);
        if (local && num(local.updatedAt) > num(row.updatedAt)) continue;
        await db.returns.put(row);
        pulled += 1;
      }
      for (const remote of body.psids) {
        const row = asPsid(remote);
        if (!row.id) continue;
        const local = await db.psids.get(row.id);
        if (local && num(local.updatedAt) > num(row.updatedAt)) continue;
        await db.psids.put(row);
        pulled += 1;
      }
    },
  );

  return { pulled, conflicts };
}
