import { db, emptyInvoice } from "../db";
import { notifyDb } from "../hooks/useLive";
import type { ImportedSaleRow } from "../lib/excel";
import { newId, nextUsin } from "../lib/ids";
import { logEvent } from "./events";
import {
  buildPayload,
  failureText,
  isPraDuplicateText,
  postInvoice,
  recalcLine,
  totalsFromItems,
  validateInvoice,
  type PraPostResult,
} from "../lib/pra";
import {
  PRA_SANDBOX_TOKEN,
  type Buyer,
  type BuyerType,
  type Client,
  type Invoice,
  type InvoiceType,
  type PaymentMode,
} from "../types";

export async function findDuplicateUsin(
  clientId: string,
  usin: string,
  exceptId?: string,
): Promise<Invoice | undefined> {
  const key = usin.trim();
  if (!key) return undefined;
  const matches = await db.invoices.where("[clientId+usin]").equals([clientId, key]).toArray();
  return matches.find((row) => row.id !== exceptId);
}

export function withTotals(invoice: Invoice, clientId: string): Invoice {
  const totals = totalsFromItems(invoice.items);
  return {
    ...invoice,
    clientId,
    usin: invoice.usin.trim(),
    refUsin: invoice.refUsin.trim(),
    ...totals,
    attemptCount: invoice.attemptCount ?? 0,
    lastCode: invoice.lastCode ?? "",
    inFlight: invoice.inFlight === true,
    updatedAt: Date.now(),
  };
}

export function praUsinAlreadyExists(invoice: Invoice): boolean {
  return isPraDuplicateText(`${invoice.lastCode} ${invoice.lastError} ${invoice.lastResponse}`);
}

export function submitGate(invoice: Invoice): {
  allow: boolean;
  reason: "posted" | "in-flight" | "usin-exists" | "unknown" | null;
  message: string;
} {
  if (invoice.status === "posted") {
    return { allow: false, reason: "posted", message: "Already posted. Daftar will not send it again." };
  }
  if (invoice.status === "unknown") {
    return {
      allow: false,
      reason: "unknown",
      message:
        "PRA result is unclear. Check IRIS → IMS Fiscal Report, then mark posted or not posted before sending again.",
    };
  }
  if (invoice.inFlight) {
    return {
      allow: false,
      reason: "in-flight",
      message: "This invoice is already being sent. Wait for PRA before trying again.",
    };
  }
  if (praUsinAlreadyExists(invoice)) {
    return {
      allow: false,
      reason: "usin-exists",
      message:
        invoice.lastError.trim() ||
        "PRA already has this USIN. Do not post again.",
    };
  }
  return { allow: true, reason: null, message: "" };
}

/** USIN must not change after an attempt whose PRA outcome is unclear or accepted. */
export function usinLocked(invoice: Pick<Invoice, "status" | "inFlight" | "attemptCount">): boolean {
  if (invoice.status === "posted" || invoice.status === "unknown") return true;
  if (invoice.inFlight) return true;
  return false;
}

export function canRemoveInvoice(invoice: Pick<Invoice, "status" | "inFlight">): boolean {
  if (invoice.status === "posted" || invoice.status === "unknown") return false;
  if (invoice.inFlight) return false;
  return true;
}

export function draftWriteGate(invoice: Invoice): {
  allow: boolean;
  reason: "posted" | "in-flight" | null;
  message: string;
} {
  if (invoice.status === "posted") {
    return { allow: false, reason: "posted", message: "Already posted. Daftar will not change it." };
  }
  if (invoice.inFlight) {
    return {
      allow: false,
      reason: "in-flight",
      message: "This invoice is already being sent. Wait for PRA before editing it.",
    };
  }
  return { allow: true, reason: null, message: "" };
}

function gateSubmitResult(invoice: Invoice, gate: ReturnType<typeof submitGate>): SubmitInvoiceResult {
  if (gate.reason === "posted") {
    return { invoice, errors: [], alreadyPosted: true, alreadyExists: false, inFlight: false };
  }
  if (gate.reason === "in-flight") {
    return { invoice, errors: [gate.message], alreadyPosted: false, alreadyExists: false, inFlight: true };
  }
  if (gate.reason === "usin-exists" || gate.reason === "unknown") {
    return {
      invoice,
      errors: [gate.message],
      alreadyPosted: false,
      alreadyExists: gate.reason === "usin-exists",
      inFlight: false,
    };
  }
  return { invoice, errors: [], alreadyPosted: false, alreadyExists: false, inFlight: false };
}

export function applyPraResult(invoice: Invoice, result: PraPostResult, client?: Client): Invoice {
  const next: Invoice = {
    ...invoice,
    inFlight: false,
    inFlightAt: undefined,
    attemptCount: (invoice.attemptCount ?? 0) + 1,
    lastCode: result.code,
    lastResponse: result.raw,
    updatedAt: Date.now(),
  };
  if (result.ok) {
    return {
      ...next,
      status: "posted",
      fiscalNumber: result.fiscalNumber,
      lastError: result.alreadyExists ? failureText(result) : "",
      postedAt: Date.now(),
      postedEnvironment: client?.environment,
      postedPosId: client?.posId?.trim() || undefined,
    };
  }
  if (result.kind === "unknown") {
    return {
      ...next,
      status: "unknown",
      lastError: failureText(result) || "PRA result is unclear. Check IRIS before posting again.",
    };
  }
  return {
    ...next,
    status: "failed",
    lastError: failureText(result) || "PRA rejected the invoice.",
  };
}

export type AdjustmentPick = {
  sourceLineId: string;
  quantity?: number;
  saleValue?: number;
};

export function splitInvoiceDateTime(value: string): { date: string; time: string } {
  const trimmed = value.trim();
  const [date = "", rawTime = "00:00:00"] = trimmed.split(/\s+/);
  const time = /^\d{2}:\d{2}$/.test(rawTime) ? `${rawTime}:00` : rawTime;
  return { date, time };
}

export function composeInvoiceDateTime(date: string, time: string): string {
  const padded = /^\d{2}:\d{2}$/.test(time.trim()) ? `${time.trim()}:00` : time.trim();
  return `${date.trim()} ${padded}`.trim();
}

export function inferBuyerKind(
  invoice: Pick<Invoice, "buyerPntn" | "buyerCnic">,
  buyer?: Pick<Buyer, "buyerType"> | null,
): BuyerType {
  if (buyer?.buyerType) return buyer.buyerType;
  if (invoice.buyerPntn.trim()) return "registered";
  if (invoice.buyerCnic.trim()) return "end_consumer";
  return "";
}

export type PosCheck = { tone: "bad" | "info"; title: string; body: string };

export function posChecks(client: Client): PosCheck[] {
  const checks: PosCheck[] = [];
  if (!client.posToken.trim()) {
    checks.push({
      tone: "bad",
      title: "eIMS token missing",
      body: "Paste the token from PRA IRIS → eIMS / POS registration before posting.",
    });
  }
  if (client.environment === "production" && !client.posToken.trim()) {
    checks.push({
      tone: "bad",
      title: "Production file has no token",
      body: "Cannot post live until the real eIMS token is on this file.",
    });
  }
  if (client.environment === "production" && client.posToken.trim() === PRA_SANDBOX_TOKEN) {
    checks.push({
      tone: "bad",
      title: "Sandbox token on a production file",
      body: "The published sandbox token will not post live invoices.",
    });
  }
  if (client.environment === "production") {
    checks.push({
      tone: "info",
      title: "PRA may still block this server’s IP",
      body: "Live posts go through this site’s locked proxy. Until PRA whitelists 187.53.143.235, production sends can fail even with a real token. Email eims@pra.punjab.gov.pk from Settings → About.",
    });
  }
  return checks;
}

export function buildAdjustmentDraft(
  source: Invoice,
  invoiceType: 2 | 3,
  usin: string,
  picks?: ReadonlyArray<AdjustmentPick>,
): Invoice {
  if (source.status !== "posted") {
    throw new Error("Credit/debit notes start from a posted invoice.");
  }
  const draft = emptyInvoice(source.clientId, usin);
  const selected =
    picks && picks.length > 0
      ? picks.flatMap((pick) => {
          const line = source.items.find((item) => item.id === pick.sourceLineId);
          if (!line) return [];
          return [
            recalcLine({
              ...line,
              id: newId("ln"),
              quantity: pick.quantity ?? line.quantity,
              saleValue: pick.saleValue ?? line.saleValue,
            }),
          ];
        })
      : source.items.map((line) =>
          recalcLine({
            ...line,
            id: newId("ln"),
          }),
        );
  return withTotals(
    {
      ...draft,
      invoiceType,
      paymentMode: source.paymentMode,
      buyerId: source.buyerId,
      buyerName: source.buyerName,
      buyerPntn: source.buyerPntn,
      buyerCnic: source.buyerCnic,
      buyerPhone: source.buyerPhone,
      buyerDistrict: source.buyerDistrict ?? "",
      extraTax: source.extraTax ?? 0,
      stWithheld: source.stWithheld ?? 0,
      reverseCharge: source.reverseCharge === true,
      saleType: source.saleType || "Services",
      taxpayerType: source.taxpayerType ?? "",
      discount: source.discount,
      refUsin: source.usin.trim(),
      items: selected,
      status: "draft",
      fiscalNumber: "",
      lastError: "",
      lastResponse: "",
      lastCode: "",
      attemptCount: 0,
      inFlight: false,
    },
    source.clientId,
  );
}

export async function saveInvoiceDraft(client: Client, invoice: Invoice): Promise<Invoice> {
  const stored = invoice.id ? await db.invoices.get(invoice.id) : undefined;
  const current = stored ?? invoice;
  const gate = draftWriteGate(current);
  if (!gate.allow) return current;
  const next = withTotals({ ...invoice, status: current.status, inFlight: false }, client.id);
  const duplicate = await findDuplicateUsin(client.id, next.usin, next.id);
  if (duplicate) return current;
  await persistInvoice(next);
  await logEvent({
    kind: "invoice.saved",
    clientId: client.id,
    title: `Saved ${next.usin}`,
    detail: next.status,
  });
  return next;
}

export async function validateInvoiceDraft(
  client: Client,
  invoice: Invoice,
): Promise<{ invoice: Invoice; errors: string[] }> {
  const stored = invoice.id ? await db.invoices.get(invoice.id) : undefined;
  const current = stored ?? invoice;
  if (current.status === "posted") {
    return { invoice: current, errors: [] };
  }
  if (current.inFlight) {
    return { invoice: current, errors: [draftWriteGate(current).message] };
  }
  const next = withTotals({ ...invoice, inFlight: false }, client.id);
  const errors = [...validateInvoice(client, next)];
  const duplicate = await findDuplicateUsin(client.id, next.usin, next.id);
  if (duplicate) errors.push("This USIN already exists in this client file.");
  next.status = errors.length ? "draft" : "validated";
  await persistInvoice(next);
  await logEvent({
    kind: "invoice.validated",
    clientId: client.id,
    title: errors.length ? `${next.usin} failed local checks` : `${next.usin} passed local checks`,
    detail: errors.join(" "),
  });
  return { invoice: next, errors };
}

export interface SubmitInvoiceResult {
  invoice: Invoice;
  errors: string[];
  result?: PraPostResult;
  alreadyPosted: boolean;
  alreadyExists: boolean;
  inFlight: boolean;
}

async function persistInvoice(invoice: Invoice): Promise<void> {
  const existing = await db.invoices.get(invoice.id);
  if (existing) await db.invoices.put(invoice);
  else await db.invoices.add(invoice);
  notifyDb();
}

export async function claimInvoiceForPost(
  id: string,
  fallback?: Invoice,
): Promise<{ ok: true; invoice: Invoice } | { ok: false; result: SubmitInvoiceResult }> {
  return db.transaction("rw", db.invoices, async () => {
    const stored = await db.invoices.get(id);
    if (!stored) {
      const invoice = fallback ?? emptyInvoice("", "");
      return {
        ok: false as const,
        result: {
          invoice,
          errors: ["Invoice not found."],
          alreadyPosted: false,
          alreadyExists: false,
          inFlight: false,
        },
      };
    }
    const gate = submitGate(stored);
    if (!gate.allow) {
      return { ok: false as const, result: gateSubmitResult(stored, gate) };
    }
    const locked: Invoice = {
      ...stored,
      inFlight: true,
      inFlightAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.invoices.put(locked);
    return { ok: true as const, invoice: locked };
  });
}

/** Locks older than this are cleared on desk open. Fresh locks from another tab stay. */
export const IN_FLIGHT_STALE_MS = 5 * 60_000;

export async function sweepHungInFlight(now = Date.now()): Promise<number> {
  const hung = await db.invoices
    .filter((row) => {
      if (row.inFlight !== true || row.status === "posted") return false;
      const started = row.inFlightAt;
      if (started == null) return true;
      return now - started >= IN_FLIGHT_STALE_MS;
    })
    .toArray();
  if (hung.length === 0) return 0;
  await db.transaction("rw", db.invoices, async () => {
    for (const row of hung) {
      await db.invoices.put({
        ...row,
        inFlight: false,
        inFlightAt: undefined,
        updatedAt: Date.now(),
      });
    }
  });
  notifyDb();
  return hung.length;
}

export async function submitInvoice(
  client: Client,
  invoice: Invoice,
): Promise<SubmitInvoiceResult> {
  const stored = invoice.id ? await db.invoices.get(invoice.id) : undefined;
  const current = stored ?? invoice;
  const gate = submitGate(current);
  if (!gate.allow) return gateSubmitResult(current, gate);

  const prepared = withTotals({ ...invoice, status: current.status, inFlight: false }, client.id);
  const errors = [...validateInvoice(client, prepared)];
  const duplicate = await findDuplicateUsin(client.id, prepared.usin, prepared.id);
  if (duplicate) errors.push("This USIN already exists in this client file.");
  if (errors.length) {
    const latest = prepared.id ? await db.invoices.get(prepared.id) : undefined;
    if (latest) {
      const latestGate = submitGate(latest);
      if (!latestGate.allow) return gateSubmitResult(latest, latestGate);
    }
    prepared.status = "draft";
    await persistInvoice(prepared);
    return { invoice: prepared, errors, alreadyPosted: false, alreadyExists: false, inFlight: false };
  }

  const claim = await claimInvoiceForPost(prepared.id, prepared);
  if (!claim.ok) return claim.result;

  try {
    const payload = buildPayload(client, prepared);
    const result = await postInvoice(client, payload);
    const next = applyPraResult(prepared, result, client);
    await persistInvoice(next);
    try {
      await logEvent({
        kind:
          next.status === "posted"
            ? "invoice.posted"
            : next.status === "unknown"
              ? "invoice.failed"
              : "invoice.failed",
        clientId: client.id,
        title:
          next.status === "posted"
            ? `Posted ${next.usin}`
            : next.status === "unknown"
              ? `Unclear PRA result for ${next.usin}`
              : `PRA rejected ${next.usin}`,
        detail: next.status === "posted" ? next.fiscalNumber : next.lastError,
      });
    } catch {
      // Activity log must never rewrite a PRA result already on the desk.
    }
    return {
      invoice: next,
      errors:
        next.status === "posted" && !result.alreadyExists
          ? []
          : next.lastError
            ? [next.lastError]
            : [],
      result,
      alreadyPosted: false,
      alreadyExists: result.alreadyExists,
      inFlight: false,
    };
  } catch (error) {
    const latest = prepared.id ? await db.invoices.get(prepared.id) : undefined;
    if (latest?.status === "posted") {
      return {
        invoice: latest,
        errors: [],
        alreadyPosted: false,
        alreadyExists: false,
        inFlight: false,
      };
    }
    if (latest?.status === "unknown") {
      return {
        invoice: latest,
        errors: latest.lastError ? [latest.lastError] : [],
        alreadyPosted: false,
        alreadyExists: false,
        inFlight: false,
      };
    }
    const unclear: Invoice = {
      ...prepared,
      inFlight: false,
      inFlightAt: undefined,
      status: "unknown",
      attemptCount: (prepared.attemptCount ?? 0) + 1,
      lastError:
        error instanceof Error
          ? `${error.message}. Check IRIS → IMS Fiscal Report before posting this USIN again.`
          : "Network error. Check IRIS before posting this USIN again.",
      updatedAt: Date.now(),
    };
    await persistInvoice(unclear);
    try {
      await logEvent({
        kind: "invoice.failed",
        clientId: client.id,
        title: `Unclear PRA result for ${unclear.usin}`,
        detail: unclear.lastError,
      });
    } catch {
      // same rule: logging must not change invoice state
    }
    return {
      invoice: unclear,
      errors: [unclear.lastError],
      alreadyPosted: false,
      alreadyExists: false,
      inFlight: false,
    };
  }
}

export async function clearInvoiceInFlight(invoice: Invoice): Promise<Invoice> {
  const latest = invoice.id ? await db.invoices.get(invoice.id) : undefined;
  if (!latest) return { ...invoice, inFlight: false, inFlightAt: undefined };
  if (latest.status === "posted") return latest;
  const next = {
    ...latest,
    inFlight: false,
    inFlightAt: undefined,
    updatedAt: Date.now(),
  };
  await persistInvoice(next);
  return next;
}

export async function createAdjustmentDraft(
  client: Client,
  source: Invoice,
  invoiceType: 2 | 3,
  picks?: ReadonlyArray<AdjustmentPick>,
): Promise<Invoice> {
  if (source.status !== "posted") {
    throw new Error("Credit/debit notes start from a posted invoice.");
  }
  const existing = await db.invoices.where("clientId").equals(client.id).toArray();
  const usin = nextUsin(client.pntn, existing.map((row) => row.usin));
  const draft = buildAdjustmentDraft(source, invoiceType, usin, picks);
  await persistInvoice(draft);
  await logEvent({
    kind: "invoice.saved",
    clientId: client.id,
    title: `Opened ${invoiceType === 3 ? "credit" : "debit"} note ${draft.usin}`,
    detail: `Ref USIN ${source.usin}`,
  });
  return draft;
}

export interface InvoiceBatchRow {
  id: string;
  usin: string;
  ok: boolean;
  skipped: boolean;
  message: string;
}

export async function validateInvoiceBatch(
  client: Client,
  invoices: ReadonlyArray<Invoice>,
): Promise<InvoiceBatchRow[]> {
  const rows: InvoiceBatchRow[] = [];
  for (const invoice of invoices) {
    if (invoice.status === "posted") {
      rows.push({ id: invoice.id, usin: invoice.usin, ok: true, skipped: true, message: "Already posted." });
      continue;
    }
    if (invoice.inFlight) {
      rows.push({
        id: invoice.id,
        usin: invoice.usin,
        ok: false,
        skipped: true,
        message: "Already being sent.",
      });
      continue;
    }
    const result = await validateInvoiceDraft(client, invoice);
    rows.push({
      id: invoice.id,
      usin: result.invoice.usin,
      ok: result.errors.length === 0,
      skipped: false,
      message: result.errors.length ? result.errors[0] ?? "Failed local checks." : "Passed local checks.",
    });
  }
  return rows;
}

export async function submitInvoiceBatch(
  client: Client,
  invoices: ReadonlyArray<Invoice>,
): Promise<InvoiceBatchRow[]> {
  const rows: InvoiceBatchRow[] = [];
  for (const invoice of invoices) {
    const gate = submitGate(invoice);
    if (!gate.allow) {
      rows.push({
        id: invoice.id,
        usin: invoice.usin,
        ok: gate.reason === "posted",
        skipped: true,
        message: gate.message,
      });
      continue;
    }
    const result = await submitInvoice(client, invoice);
    if (result.alreadyPosted) {
      rows.push({ id: invoice.id, usin: invoice.usin, ok: true, skipped: true, message: "Already posted." });
      continue;
    }
    if (result.alreadyExists) {
      rows.push({
        id: invoice.id,
        usin: result.invoice.usin,
        ok: result.invoice.status === "posted",
        skipped: true,
        message: result.errors[0] ?? "PRA already has this USIN.",
      });
      continue;
    }
    if (result.inFlight) {
      rows.push({
        id: invoice.id,
        usin: result.invoice.usin,
        ok: false,
        skipped: true,
        message: result.errors[0] ?? "Already being sent.",
      });
      continue;
    }
    rows.push({
      id: invoice.id,
      usin: result.invoice.usin,
      ok: result.errors.length === 0 && result.invoice.status === "posted",
      skipped: false,
      message:
        result.errors[0] ??
        (result.invoice.status === "posted" ? "Posted." : "PRA rejected the invoice."),
    });
  }
  return rows;
}

export type SalesImportPreviewRow = {
  usin: string;
  dateTime: string;
  buyerName: string;
  lineCount: number;
  errors: string[];
  draft?: Invoice;
};

function draftFromImportedLines(client: Client, usin: string, lines: ImportedSaleRow[]): Invoice {
  const first = lines[0];
  const draft = emptyInvoice(client.id, usin);
  if (!first) return draft;
  const items = lines.map((line) =>
    recalcLine({
      id: newId("ln"),
      itemCode: line.ItemCode,
      itemName: line.ItemName,
      quantity: line.Quantity,
      pctCode: line.PCTCode,
      taxRate: line.TaxRate,
      saleValue: line.SaleValue,
      discount: line.Discount,
      furtherTax: line.FurtherTax,
      taxCharged: 0,
      totalAmount: 0,
    }),
  );
  const headerDiscount = first.HeaderDiscount ?? 0;
  const lineSum = items.reduce((sum, line) => sum + line.discount, 0);
  if (lineSum === 0 && headerDiscount > 0 && items[0]) {
    items[0] = recalcLine({ ...items[0], discount: headerDiscount });
  }
  return withTotals(
    {
      ...draft,
      dateTime: first.DateTime || draft.dateTime,
      invoiceType: (first.InvoiceType as InvoiceType) || 1,
      paymentMode: (first.PaymentMode as PaymentMode) || 1,
      buyerName: first.BuyerName,
      buyerPntn: first.BuyerPNTN,
      buyerCnic: first.BuyerCNIC,
      buyerPhone: first.BuyerPhone,
      buyerDistrict: first.BuyerDistrict ?? "",
      extraTax: first.ExtraTax ?? 0,
      stWithheld: first.StWithheld ?? 0,
      reverseCharge: first.ReverseCharge === true,
      saleType: first.SaleType?.trim() || "Services",
      taxpayerType: first.TaxpayerType ?? "",
      discount: 0,
      refUsin: first.RefUSIN,
      items,
      status: "draft",
      inFlight: false,
    },
    client.id,
  );
}

export async function previewSalesImport(
  client: Client,
  file: File,
): Promise<{ rows: SalesImportPreviewRow[] }> {
  const { parseSalesWorkbook } = await import("../lib/excel");
  const parsed = await parseSalesWorkbook(file);
  const grouped = new Map<string, ImportedSaleRow[]>();
  for (const row of parsed) {
    const usin = row.USIN.trim();
    if (!usin) continue;
    const list = grouped.get(usin) ?? [];
    list.push(row);
    grouped.set(usin, list);
  }
  const rows: SalesImportPreviewRow[] = [];
  for (const [usin, lines] of grouped) {
    const first = lines[0];
    const draft = draftFromImportedLines(client, usin, lines);
    const errors = [...validateInvoice(client, draft)];
    if (await findDuplicateUsin(client.id, usin)) {
      errors.push("This USIN already exists in this client file.");
    }
    rows.push({
      usin,
      dateTime: first?.DateTime || draft.dateTime,
      buyerName: first?.BuyerName || "",
      lineCount: lines.length,
      errors,
      draft,
    });
  }
  return { rows };
}

export async function commitSalesImport(
  client: Client,
  drafts: ReadonlyArray<Invoice>,
): Promise<{ saved: number; skipped: number }> {
  let saved = 0;
  let skipped = 0;
  for (const incoming of drafts) {
    const next = withTotals({ ...incoming, status: "draft", inFlight: false }, client.id);
    const errors = [...validateInvoice(client, next)];
    if (await findDuplicateUsin(client.id, next.usin, next.id)) {
      errors.push("This USIN already exists in this client file.");
    }
    if (errors.length) {
      skipped += 1;
      continue;
    }
    await persistInvoice(next);
    saved += 1;
  }
  if (saved) {
    await logEvent({
      kind: "invoice.imported",
      clientId: client.id,
      title: `Imported ${saved} invoice${saved === 1 ? "" : "s"}`,
      detail: "Drafts only until you validate or post.",
    });
  }
  return { saved, skipped };
}

export async function importSalesFile(client: Client, file: File): Promise<number> {
  const preview = await previewSalesImport(client, file);
  const drafts = preview.rows
    .filter((row) => row.draft && row.errors.length === 0)
    .map((row) => row.draft as Invoice);
  const { saved } = await commitSalesImport(client, drafts);
  return saved;
}

export async function cloneInvoiceDraft(client: Client, source: Invoice): Promise<Invoice> {
  const existing = await db.invoices.where("clientId").equals(client.id).toArray();
  const usin = nextUsin(client.pntn || client.cnic, existing.map((row) => row.usin));
  const draft = withTotals(
    {
      ...source,
      id: newId("inv"),
      clientId: client.id,
      usin,
      invoiceType: 1,
      refUsin: "",
      status: "draft",
      fiscalNumber: "",
      lastError: "",
      lastResponse: "",
      lastCode: "",
      attemptCount: 0,
      inFlight: false,
      postedAt: undefined,
      items: source.items.map((line) => ({ ...line, id: newId("ln") })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    client.id,
  );
  await persistInvoice(draft);
  await logEvent({
    kind: "invoice.saved",
    clientId: client.id,
    title: `Cloned draft ${draft.usin}`,
    detail: `From ${source.usin}`,
  });
  return draft;
}

export function isRetryablePraError(text: string): boolean {
  return /network|timeout|failed to fetch|502|504|cors|proxy|ssl|econnreset|offline|unclear|check iris/i.test(
    text,
  );
}

/** Invoices that need a human decision or a careful sandbox retry — never auto-posted. */
export async function listPostRetryCandidates(clientId: string): Promise<Invoice[]> {
  const rows = await db.invoices.where("clientId").equals(clientId).toArray();
  return rows.filter(
    (row) =>
      !row.inFlight &&
      (row.status === "unknown" ||
        (row.status === "failed" && isRetryablePraError(`${row.lastError} ${row.lastCode}`))),
  );
}

/**
 * @deprecated Silent auto-repost is unsafe. Use listPostRetryCandidates + explicit confirm.
 * Kept as a no-op so old callers do not post.
 */
export async function retryFailedNetworkPosts(_client: Client): Promise<number> {
  return 0;
}

export async function removeInvoiceDraft(invoice: Invoice): Promise<void> {
  if (!canRemoveInvoice(invoice)) {
    if (invoice.status === "posted") {
      throw new Error("Posted invoices stay on the desk.");
    }
    if (invoice.status === "unknown") {
      throw new Error("Reconcile this USIN on IRIS before removing it.");
    }
    throw new Error("This invoice is being sent. Wait for PRA before removing it.");
  }
  await db.invoices.delete(invoice.id);
  await logEvent({
    kind: "invoice.removed",
    clientId: invoice.clientId,
    title: `Removed ${invoice.usin}`,
    detail: invoice.status,
  });
  notifyDb();
}

export async function reconcileInvoicePosted(
  client: Client,
  invoice: Invoice,
  fiscalNumber: string,
): Promise<Invoice> {
  const stored = invoice.id ? await db.invoices.get(invoice.id) : undefined;
  const current = stored ?? invoice;
  if (current.status !== "unknown") {
    throw new Error("Only unclear invoices can be reconciled from IRIS.");
  }
  const fiscal = fiscalNumber.trim();
  if (!fiscal) throw new Error("Enter the fiscal number from IRIS → IMS Fiscal Report.");
  const next: Invoice = {
    ...current,
    status: "posted",
    fiscalNumber: fiscal,
    lastError: "",
    inFlight: false,
    inFlightAt: undefined,
    postedAt: Date.now(),
    postedEnvironment: client.environment,
    postedPosId: client.posId.trim() || undefined,
    updatedAt: Date.now(),
  };
  await persistInvoice(next);
  await logEvent({
    kind: "invoice.posted",
    clientId: client.id,
    title: `Reconciled ${next.usin} as posted`,
    detail: fiscal,
  });
  return next;
}

export async function reconcileInvoiceNotPosted(invoice: Invoice): Promise<Invoice> {
  const stored = invoice.id ? await db.invoices.get(invoice.id) : undefined;
  const current = stored ?? invoice;
  if (current.status !== "unknown") {
    throw new Error("Only unclear invoices can be reconciled from IRIS.");
  }
  const next: Invoice = {
    ...current,
    status: "failed",
    fiscalNumber: "",
    lastError: "Marked not posted after IRIS check. Safe to fix and retry once.",
    inFlight: false,
    inFlightAt: undefined,
    updatedAt: Date.now(),
  };
  await persistInvoice(next);
  await logEvent({
    kind: "invoice.failed",
    clientId: current.clientId,
    title: `Reconciled ${next.usin} as not posted`,
    detail: next.lastError,
  });
  return next;
}
