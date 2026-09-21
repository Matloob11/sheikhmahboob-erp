import type { BankDraft } from "../../domain/banks";
import type { ClientDraft } from "../../domain/clients";
import type { PlaceDraft } from "../../domain/places";
import type { PosDeviceDraft } from "../../domain/posDevices";
import type { Client } from "../../types";

export const PAGE_SIZE = 50;

export function draftFromClient(row: Client): ClientDraft {
  return {
    businessName: row.businessName,
    brandName: row.brandName,
    pntn: row.pntn,
    cnic: row.cnic,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    sector: row.sector,
    branchName: row.branchName,
    posId: row.posId,
    posToken: row.posToken,
    environment: row.environment,
    postingMode: row.postingMode === "server" ? "server" : "browser",
    notes: row.notes,
    ntn: row.ntn ?? "",
    personName: row.personName ?? "",
    personType: row.personType ?? "",
    businessId: row.businessId ?? "",
    branchId: row.branchId ?? "",
    stStatus: row.stStatus ?? "",
    registeredOn: row.registeredOn ?? "",
    archived: row.archived === true,
    cnicAsRegistration: row.cnicAsRegistration === true,
  };
}

export const blankPlace: PlaceDraft = {
  label: "",
  address: "",
  city: "",
  district: "",
  province: "Punjab",
  branchId: "",
  isPrimary: false,
};

export const blankBank: BankDraft = {
  bankName: "",
  accountTitle: "",
  accountNo: "",
  iban: "",
  isPrimary: false,
  notes: "",
};

export const blankPos: PosDeviceDraft = { posId: "", label: "", environment: "sandbox" };
