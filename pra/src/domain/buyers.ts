import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { newId } from "../lib/ids";
import { isCnic, isEmail, isPntn } from "./validate";
import { logEvent } from "./events";
import { matchesQuery } from "./catalog";
import type { Buyer, Invoice } from "../types";

export type BuyerDraft = Omit<Buyer, "id" | "clientId" | "createdAt" | "updatedAt">;

export function searchBuyers(rows: ReadonlyArray<Buyer>, query: string): Buyer[] {
  return rows.filter((row) =>
    matchesQuery(query, [
      row.name,
      row.pntn,
      row.cnic,
      row.phone,
      row.address ?? "",
      row.district ?? "",
      row.email ?? "",
      row.buyerType ?? "",
    ]),
  );
}

export function validateBuyer(
  draft: Pick<BuyerDraft, "name" | "pntn" | "cnic"> & Partial<Pick<BuyerDraft, "email">>,
): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Buyer name is required.");
  if (draft.pntn.trim() && !isPntn(draft.pntn)) errors.push("PNTN should look like 1234567-8.");
  if (draft.cnic.trim() && !isCnic(draft.cnic)) errors.push("CNIC must be 13 digits if provided.");
  if (draft.email?.trim() && !isEmail(draft.email)) errors.push("Email address is not valid.");
  return errors;
}

export function applyBuyerToInvoice(buyer: Buyer): Pick<
  Invoice,
  "buyerId" | "buyerName" | "buyerPntn" | "buyerCnic" | "buyerPhone" | "buyerDistrict"
> {
  return {
    buyerId: buyer.id,
    buyerName: buyer.name,
    buyerPntn: buyer.pntn,
    buyerCnic: buyer.cnic,
    buyerPhone: buyer.phone,
    buyerDistrict: buyer.district ?? "",
  };
}

export function buyerDraftFromInvoice(invoice: Invoice): BuyerDraft {
  return {
    name: invoice.buyerName,
    pntn: invoice.buyerPntn,
    cnic: invoice.buyerCnic,
    phone: invoice.buyerPhone,
    notes: "",
    address: "",
    district: invoice.buyerDistrict ?? "",
    email: "",
    buyerType: "",
  };
}

export async function saveBuyer(
  clientId: string,
  draft: BuyerDraft,
  editingId?: string,
): Promise<{ buyer: Buyer; errors: string[] }> {
  const errors = validateBuyer(draft);
  const now = Date.now();
  if (errors.length) {
    return {
      buyer: { ...draft, id: editingId ?? "", clientId, createdAt: 0, updatedAt: now },
      errors,
    };
  }
  if (editingId) {
    const prev = await db.buyers.get(editingId);
    if (!prev) {
      return {
        buyer: { ...draft, id: editingId, clientId, createdAt: 0, updatedAt: now },
        errors: ["Buyer not found."],
      };
    }
    const buyer: Buyer = { ...prev, ...draft, clientId, updatedAt: now };
    await db.buyers.put(buyer);
    await logEvent({ kind: "buyer.saved", clientId, title: `Updated buyer ${buyer.name}` });
    notifyDb();
    return { buyer, errors: [] };
  }
  const buyer: Buyer = { ...draft, id: newId("byr"), clientId, createdAt: now, updatedAt: now };
  await db.buyers.add(buyer);
  await logEvent({ kind: "buyer.saved", clientId, title: `Saved buyer ${buyer.name}` });
  notifyDb();
  return { buyer, errors: [] };
}

export async function removeBuyer(id: string): Promise<void> {
  const row = await db.buyers.get(id);
  await db.buyers.delete(id);
  await logEvent({
    kind: "buyer.removed",
    clientId: row?.clientId,
    title: row ? `Removed buyer ${row.name}` : "Removed a buyer",
  });
  notifyDb();
}
