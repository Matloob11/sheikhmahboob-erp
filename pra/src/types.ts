export type Environment = "sandbox" | "production";
export type InvoiceStatus = "draft" | "validated" | "posted" | "failed" | "unknown";
export type InvoiceType = 1 | 2 | 3;
export type PaymentMode = 1 | 2 | 3 | 4 | 5 | 6;
export type PsidStatus = "planned" | "generated" | "paid" | "claimed";
export type ReturnStatus = "open" | "ready" | "filed";
export type PersonType = "individual" | "aop" | "company" | "";
export type BuyerType = "registered" | "unregistered" | "end_consumer" | "intermediary" | "";

export type EventKind =
  | "client.saved"
  | "client.removed"
  | "invoice.saved"
  | "invoice.validated"
  | "invoice.posted"
  | "invoice.failed"
  | "invoice.imported"
  | "invoice.removed"
  | "purchase.added"
  | "purchase.updated"
  | "return.ready"
  | "return.filed"
  | "return.unlocked"
  | "psid.saved"
  | "psid.removed"
  | "backup.imported"
  | "buyer.saved"
  | "buyer.removed"
  | "item.saved"
  | "item.removed"
  | "pct.saved"
  | "pct.removed"
  | "purchase.removed";

export interface Settings {
  id: "desk";
  firmName: string;
  selectedClientId?: string;
  workingPeriod: string;
  /** Calendar month (1–12) when the practice fiscal year starts. Default 7 (July). */
  fiscalYearStart?: number;
  theme?: "light" | "dark" | "system";
  /** PBKDF2 digest of the practice PIN. Never store the PIN itself. */
  practicePinHash?: string;
  practicePinSalt?: string;
}

export interface DeskEvent {
  id: string;
  clientId?: string;
  kind: EventKind;
  title: string;
  detail: string;
  createdAt: number;
}

export interface Client {
  id: string;
  businessName: string;
  brandName: string;
  pntn: string;
  cnic: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  sector: string;
  branchName: string;
  posId: string;
  posToken: string;
  environment: Environment;
  /** browser = desk posts via /pra-ims; server = desk enqueues to /pra-api. Default browser. */
  postingMode?: "browser" | "server";
  notes: string;
  ntn?: string;
  personName?: string;
  personType?: PersonType;
  businessId?: string;
  branchId?: string;
  stStatus?: string;
  registeredOn?: string;
  archived?: boolean;
  cnicAsRegistration?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ClientPlace {
  id: string;
  clientId: string;
  label: string;
  address: string;
  city: string;
  district: string;
  province: string;
  branchId: string;
  isPrimary: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ClientBank {
  id: string;
  clientId: string;
  bankName: string;
  accountTitle: string;
  accountNo: string;
  iban: string;
  isPrimary: boolean;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClientPosDevice {
  id: string;
  clientId: string;
  placeId?: string;
  posId: string;
  label: string;
  environment: Environment;
  createdAt: number;
  updatedAt: number;
}

export interface InvoiceLine {
  id: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  pctCode: string;
  taxRate: number;
  saleValue: number;
  discount: number;
  furtherTax: number;
  taxCharged: number;
  totalAmount: number;
}

export interface Invoice {
  id: string;
  clientId: string;
  usin: string;
  invoiceType: InvoiceType;
  paymentMode: PaymentMode;
  dateTime: string;
  buyerId?: string;
  buyerName: string;
  buyerPntn: string;
  buyerCnic: string;
  buyerPhone: string;
  discount: number;
  furtherTax: number;
  totalQuantity: number;
  totalSaleValue: number;
  totalTaxCharged: number;
  totalBillAmount: number;
  refUsin: string;
  items: InvoiceLine[];
  status: InvoiceStatus;
  fiscalNumber: string;
  lastError: string;
  lastResponse: string;
  lastCode: string;
  attemptCount: number;
  inFlight?: boolean;
  /** When the send lock was taken — used to sweep only stale locks. */
  inFlightAt?: number;
  postedAt?: number;
  /** Environment used for the successful PostData call. */
  postedEnvironment?: Environment;
  /** POS ID sent with the successful PostData call. */
  postedPosId?: string;
  extraTax?: number;
  stWithheld?: number;
  reverseCharge?: boolean;
  saleType?: string;
  taxpayerType?: string;
  buyerDistrict?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Purchase {
  id: string;
  clientId: string;
  period: string;
  supplierName: string;
  supplierPntn: string;
  invoiceNo: string;
  invoiceDate: string;
  saleValue: number;
  taxRate: number;
  taxCharged: number;
  totalAmount: number;
  notes: string;
  /** Non-adjustable input tax — excluded from ledger net payable. */
  blockedCredit?: boolean;
  supplierCnic?: string;
  pctCode?: string;
  district?: string;
  withheld?: number;
  reverseCharge?: boolean;
  createdAt: number;
  updatedAt?: number;
}

export interface ReturnPeriod {
  id: string;
  clientId: string;
  period: string;
  status: ReturnStatus;
  notes: string;
  filedAt?: number;
  irisAck?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PsidRecord {
  id: string;
  clientId: string;
  period: string;
  amount: number;
  head: string;
  psid: string;
  cpr: string;
  bank: string;
  paidOn: string;
  status: PsidStatus;
  notes: string;
  dueOn?: string;
  paidAmount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Buyer {
  id: string;
  clientId: string;
  name: string;
  pntn: string;
  cnic: string;
  phone: string;
  notes: string;
  address?: string;
  district?: string;
  email?: string;
  buyerType?: BuyerType;
  createdAt: number;
  updatedAt: number;
}

export interface CatalogItem {
  id: string;
  clientId: string;
  itemCode: string;
  itemName: string;
  pctCode: string;
  taxRate: number;
  unit?: string;
  defaultQty?: number;
  inactive?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PctCode {
  id: string;
  pctCode: string;
  name: string;
  taxRate: number;
  seeded: boolean;
  createdAt: number;
  updatedAt: number;
}

export const PAYMENT_MODES: ReadonlyArray<{ value: PaymentMode; label: string }> = [
  { value: 1, label: "Cash" },
  { value: 2, label: "Card" },
  { value: 3, label: "Gift voucher" },
  { value: 4, label: "Loyalty card" },
  { value: 5, label: "Mixed" },
  { value: 6, label: "Cheque" },
];

export const INVOICE_TYPES: ReadonlyArray<{ value: InvoiceType; label: string }> = [
  { value: 1, label: "New" },
  { value: 2, label: "Debit" },
  { value: 3, label: "Credit" },
];

export const PERSON_TYPES: ReadonlyArray<{ value: PersonType; label: string }> = [
  { value: "", label: "Not set" },
  { value: "individual", label: "Individual" },
  { value: "aop", label: "AOP" },
  { value: "company", label: "Company" },
];

export const BUYER_TYPES: ReadonlyArray<{ value: BuyerType; label: string }> = [
  { value: "", label: "Not set" },
  { value: "registered", label: "Registered" },
  { value: "unregistered", label: "Unregistered" },
  { value: "end_consumer", label: "End consumer" },
  { value: "intermediary", label: "Intermediary" },
];

export const SECTORS = [
  "Restaurants",
  "Hotel",
  "Courier",
  "Beauty parlor",
  "IT / IT-enabled",
  "Construction",
  "Consultancy",
  "Franchise",
  "Transport",
  "Other services",
] as const;

export const PRA_SANDBOX_URL = "https://ims.pral.com.pk/ims/sandbox/api/Live/PostData";
export const PRA_PRODUCTION_URL = "https://ims.pral.com.pk/ims/production/api/Live/PostData";

/** Published in PRA POS Component User Manual (sandbox only). */
export const PRA_SANDBOX_TOKEN = "24d8fab3-f2e9-398f-ae17-b387125ec4a2";
