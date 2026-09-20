import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, Invoice } from "../types";
import { PRA_SANDBOX_TOKEN } from "../types";
import { recalcLine, totalsFromItems, type PraPostResult } from "../lib/pra";

const { invoiceStore, postInvoice, parseSalesWorkbook, logEvent } = vi.hoisted(() => ({
  invoiceStore: new Map<string, Invoice>(),
  postInvoice: vi.fn(),
  parseSalesWorkbook: vi.fn(),
  logEvent: vi.fn(async () => undefined),
}));

vi.mock("../hooks/useLive", () => ({ notifyDb: () => undefined }));
vi.mock("./events", () => ({ logEvent }));
vi.mock("../db", () => {
  const table = {
    get: async (id: string) => invoiceStore.get(id),
    put: async (row: Invoice) => {
      invoiceStore.set(row.id, row);
    },
    add: async (row: Invoice) => {
      invoiceStore.set(row.id, row);
    },
    delete: async (id: string) => {
      invoiceStore.delete(id);
    },
    filter: (pred: (row: Invoice) => boolean) => ({
      toArray: async () => [...invoiceStore.values()].filter(pred),
    }),
    where: (index: string) => ({
      equals: (key: string | [string, string]) => ({
        toArray: async () => {
          if (index === "[clientId+usin]" && Array.isArray(key)) {
            const [clientId, usin] = key;
            return [...invoiceStore.values()].filter(
              (row) => row.clientId === clientId && row.usin.trim() === usin,
            );
          }
          if (index === "clientId" && typeof key === "string") {
            return [...invoiceStore.values()].filter((row) => row.clientId === key);
          }
          return [...invoiceStore.values()];
        },
      }),
    }),
  };
  return {
    db: {
      invoices: table,
      transaction: async (_mode: string, _tables: unknown, fn: () => Promise<unknown>) => fn(),
    },
    emptyInvoice: (clientId: string, usin: string): Invoice => ({
      id: `inv_${usin || "blank"}`,
      clientId,
      usin,
      invoiceType: 1,
      paymentMode: 1,
      dateTime: "2026-09-14 10:00:00",
      buyerName: "",
      buyerPntn: "",
      buyerCnic: "",
      buyerPhone: "",
      discount: 0,
      furtherTax: 0,
      totalQuantity: 0,
      totalSaleValue: 0,
      totalTaxCharged: 0,
      totalBillAmount: 0,
      refUsin: "",
      items: [],
      status: "draft",
      fiscalNumber: "",
      lastError: "",
      lastResponse: "",
      lastCode: "",
      attemptCount: 0,
      createdAt: 1,
      updatedAt: 1,
    }),
  };
});

vi.mock("../lib/pra", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pra")>();
  return { ...actual, postInvoice };
});
vi.mock("../lib/excel", () => ({ parseSalesWorkbook }));

import {
  applyPraResult,
  buildAdjustmentDraft,
  canRemoveInvoice,
  claimInvoiceForPost,
  clearInvoiceInFlight,
  draftWriteGate,
  findDuplicateUsin,
  commitSalesImport,
  importSalesFile,
  IN_FLIGHT_STALE_MS,
  previewSalesImport,
  reconcileInvoiceNotPosted,
  reconcileInvoicePosted,
  removeInvoiceDraft,
  submitGate,
  submitInvoice,
  sweepHungInFlight,
  usinLocked,
  validateInvoiceDraft,
  withTotals,
} from "./invoices";

function postedInvoice(): Invoice {
  return {
    id: "inv_1",
    clientId: "cli_1",
    usin: "DFT-1234567-20260914-001",
    invoiceType: 1,
    paymentMode: 2,
    dateTime: "2026-09-14 10:00:00",
    buyerName: "Buyer Co",
    buyerPntn: "1234567-8",
    buyerCnic: "3520212345671",
    buyerPhone: "03001234567",
    discount: 10,
    furtherTax: 5,
    totalQuantity: 1,
    totalSaleValue: 10000,
    totalTaxCharged: 1600,
    totalBillAmount: 11595,
    refUsin: "",
    items: [
      recalcLine({
        id: "ln_1",
        itemCode: "IT_001",
        itemName: "Consultancy fee",
        quantity: 1,
        pctCode: "00000000",
        taxRate: 16,
        saleValue: 10000,
        discount: 0,
        furtherTax: 5,
        taxCharged: 0,
        totalAmount: 0,
      }),
    ],
    status: "posted",
    fiscalNumber: "9000052011142444901",
    lastError: "",
    lastResponse: '{"Code":"100"}',
    lastCode: "100",
    attemptCount: 1,
    inFlight: false,
    postedAt: 10,
    createdAt: 1,
    updatedAt: 1,
  };
}

function result(partial: Partial<PraPostResult>): PraPostResult {
  return {
    ok: false,
    fiscalNumber: "",
    code: "",
    message: "",
    nextAction: "",
    alreadyExists: false,
    kind: "rejected",
    raw: "",
    ...partial,
  };
}

const client: Client = {
  id: "cli_1",
  businessName: "Demo",
  brandName: "Demo",
  pntn: "1234567-8",
  cnic: "",
  phone: "",
  email: "",
  address: "",
  city: "Lahore",
  sector: "Consultancy",
  branchName: "HO",
  posId: "100000",
  posToken: PRA_SANDBOX_TOKEN,
  environment: "sandbox",
  notes: "",
  createdAt: 1,
  updatedAt: 1,
};

function readyInvoice(partial: Partial<Invoice> = {}): Invoice {
  return {
    ...postedInvoice(),
    status: "validated",
    fiscalNumber: "",
    lastError: "",
    lastResponse: "",
    lastCode: "",
    attemptCount: 0,
    inFlight: false,
    postedAt: undefined,
    ...partial,
  };
}

beforeEach(() => {
  invoiceStore.clear();
  postInvoice.mockReset();
  parseSalesWorkbook.mockReset();
  logEvent.mockReset();
  logEvent.mockResolvedValue(undefined);
});

describe("invoice lock", () => {
  it("never sends a posted invoice again", () => {
    const gate = submitGate(postedInvoice());
    expect(gate.allow).toBe(false);
    expect(gate.reason).toBe("posted");
  });

  it("blocks a second click while in flight", () => {
    const gate = submitGate({ ...postedInvoice(), status: "validated", inFlight: true, fiscalNumber: "" });
    expect(gate.allow).toBe(false);
    expect(gate.reason).toBe("in-flight");
  });

  it("does not let a draft save clear the send lock", () => {
    const sending = { ...postedInvoice(), status: "validated" as const, inFlight: true, fiscalNumber: "" };
    const gate = draftWriteGate(sending);
    expect(gate.allow).toBe(false);
    expect(gate.reason).toBe("in-flight");
    expect(draftWriteGate(postedInvoice()).reason).toBe("posted");
  });

  it("shows USIN already exists instead of allowing another post", () => {
    const gate = submitGate({
      ...postedInvoice(),
      status: "failed",
      fiscalNumber: "",
      lastError: "USIN already exists",
      lastResponse: '{"Response":"USIN already exists"}',
    });
    expect(gate.allow).toBe(false);
    expect(gate.reason).toBe("usin-exists");
  });

  it("clears the in-flight flag when a result arrives", () => {
    const next = applyPraResult(
      { ...postedInvoice(), status: "validated", inFlight: true, fiscalNumber: "", postedAt: undefined },
      result({
        ok: true,
        code: "100",
        fiscalNumber: "9000052011142444901",
        kind: "success",
        raw: '{"Code":"100"}',
      }),
    );
    expect(next.inFlight).toBe(false);
    expect(next.status).toBe("posted");
  });

  it("keeps a duplicate without a fiscal number off the posted shelf", () => {
    const next = applyPraResult(
      { ...postedInvoice(), status: "validated", fiscalNumber: "", postedAt: undefined },
      result({
        alreadyExists: true,
        kind: "already_exists",
        message: "USIN already exists",
        nextAction: "Do not post again.",
        raw: '{"Response":"USIN already exists"}',
      }),
    );
    expect(next.status).toBe("failed");
    expect(next.lastError).toMatch(/USIN already exists/);
    expect(submitGate(next).reason).toBe("usin-exists");
  });

  it("does not promote a duplicate with a fiscal number unless PRA returned a success code", () => {
    const next = applyPraResult(
      { ...postedInvoice(), status: "validated", fiscalNumber: "", postedAt: undefined },
      result({
        ok: false,
        alreadyExists: true,
        fiscalNumber: "9000052011142444901",
        kind: "already_exists",
        message: "USIN already exists",
        nextAction: "Do not post again.",
      }),
    );
    expect(next.status).toBe("failed");
    expect(submitGate(next).reason).toBe("usin-exists");
  });
});

describe("credit/debit note", () => {
  it("copies USIN into RefUSIN with type 3 and the original lines", () => {
    const source = postedInvoice();
    const note = buildAdjustmentDraft(source, 3, "DFT-1234567-20260914-002");
    expect(note.status).toBe("draft");
    expect(note.invoiceType).toBe(3);
    expect(note.refUsin).toBe(source.usin);
    expect(note.usin).toBe("DFT-1234567-20260914-002");
    expect(note.fiscalNumber).toBe("");
    expect(note.inFlight).toBe(false);
    expect(note.buyerName).toBe(source.buyerName);
    expect(note.items).toHaveLength(1);
    expect(note.items[0]?.itemName).toBe("Consultancy fee");
    expect(note.items[0]?.furtherTax).toBe(5);
    expect(note.items[0]?.id).not.toBe(source.items[0]?.id);
    expect(source.status).toBe("posted");
    expect(source.usin).toBe("DFT-1234567-20260914-001");
  });

  it("builds a debit note as type 2", () => {
    const note = buildAdjustmentDraft(postedInvoice(), 2, "DFT-1234567-20260914-003");
    expect(note.invoiceType).toBe(2);
    expect(note.refUsin).toBe("DFT-1234567-20260914-001");
  });

  it("refuses to credit a draft", () => {
    expect(() =>
      buildAdjustmentDraft({ ...postedInvoice(), status: "draft" }, 3, "DFT-1234567-20260914-004"),
    ).toThrow(/posted invoice/);
  });

  it("copies only the picked line at a reduced sale value", () => {
    const source = postedInvoice();
    source.items = [
      recalcLine({
        id: "ln_1",
        itemCode: "IT_001",
        itemName: "Consultancy fee",
        quantity: 1,
        pctCode: "00000000",
        taxRate: 16,
        saleValue: 10000,
        discount: 0,
        furtherTax: 5,
        taxCharged: 0,
        totalAmount: 0,
      }),
      recalcLine({
        id: "ln_2",
        itemCode: "IT_002",
        itemName: "Second line",
        quantity: 2,
        pctCode: "98154000",
        taxRate: 16,
        saleValue: 4000,
        discount: 0,
        furtherTax: 0,
        taxCharged: 0,
        totalAmount: 0,
      }),
    ];
    const note = buildAdjustmentDraft(source, 3, "DFT-1234567-20260914-005", [
      { sourceLineId: "ln_2", saleValue: 2000 },
    ]);
    expect(note.items).toHaveLength(1);
    expect(note.items[0]?.itemName).toBe("Second line");
    expect(note.items[0]?.saleValue).toBe(2000);
    expect(note.items[0]?.quantity).toBe(2);
    const full = buildAdjustmentDraft(source, 3, "DFT-1234567-20260914-006");
    expect(full.items).toHaveLength(2);
  });
});

describe("totals and USIN", () => {
  it("keeps header furtherTax equal to the line sum", () => {
    const invoice = withTotals(
      {
        ...readyInvoice(),
        furtherTax: 99,
        items: [
          recalcLine({
            id: "ln_1",
            itemCode: "IT_001",
            itemName: "A",
            quantity: 1,
            pctCode: "98151000",
            taxRate: 16,
            saleValue: 1000,
            discount: 0,
            furtherTax: 20,
            taxCharged: 0,
            totalAmount: 0,
          }),
          recalcLine({
            id: "ln_2",
            itemCode: "IT_002",
            itemName: "B",
            quantity: 1,
            pctCode: "98154000",
            taxRate: 16,
            saleValue: 2000,
            discount: 0,
            furtherTax: 30,
            taxCharged: 0,
            totalAmount: 0,
          }),
        ],
      },
      "cli_1",
    );
    expect(invoice.furtherTax).toBe(50);
    expect(invoice.furtherTax).toBe(totalsFromItems(invoice.items, invoice.discount).furtherTax);
  });

  it("trims USIN so the compound index matches", () => {
    expect(withTotals({ ...readyInvoice(), usin: "  DFT-1  " }, "cli_1").usin).toBe("DFT-1");
  });

  it("finds another invoice with the same client+USIN", async () => {
    const first = readyInvoice({ id: "inv_a", usin: "DFT-DUP" });
    const second = readyInvoice({ id: "inv_b", usin: "DFT-DUP" });
    invoiceStore.set(first.id, first);
    invoiceStore.set(second.id, second);
    expect((await findDuplicateUsin("cli_1", " DFT-DUP ", "inv_a"))?.id).toBe("inv_b");
    expect(await findDuplicateUsin("cli_1", "DFT-OTHER")).toBeUndefined();
  });

  it("rejects a second draft that reuses a USIN", async () => {
    invoiceStore.set("inv_a", readyInvoice({ id: "inv_a", usin: "DFT-DUP" }));
    const copy = readyInvoice({ id: "inv_b", usin: "DFT-DUP" });
    invoiceStore.set("inv_b", copy);
    const result = await validateInvoiceDraft(client, copy);
    expect(result.errors).toContain("This USIN already exists in this client file.");
  });
});

describe("inFlight sweep and claim", () => {
  it("clears only stale locks, not fresh ones from another tab", async () => {
    const now = Date.now();
    invoiceStore.set("stale", readyInvoice({ id: "stale", status: "draft", inFlight: true, inFlightAt: now - IN_FLIGHT_STALE_MS - 1 }));
    invoiceStore.set("fresh", readyInvoice({ id: "fresh", status: "validated", inFlight: true, inFlightAt: now - 1_000 }));
    invoiceStore.set("legacy", readyInvoice({ id: "legacy", status: "failed", inFlight: true }));
    invoiceStore.set("p", { ...postedInvoice(), id: "p", inFlight: true, inFlightAt: now - IN_FLIGHT_STALE_MS - 1 });
    const cleared = await sweepHungInFlight(now);
    expect(cleared).toBe(2);
    expect(invoiceStore.get("stale")?.inFlight).toBe(false);
    expect(invoiceStore.get("fresh")?.inFlight).toBe(true);
    expect(invoiceStore.get("legacy")?.inFlight).toBe(false);
    expect(invoiceStore.get("p")?.inFlight).toBe(true);
  });

  it("lets only the first claim post", async () => {
    const invoice = readyInvoice();
    invoiceStore.set(invoice.id, invoice);
    const first = await claimInvoiceForPost(invoice.id);
    const second = await claimInvoiceForPost(invoice.id);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.invoice.inFlightAt).toBeTypeOf("number");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.result.inFlight).toBe(true);
    }
    expect(postInvoice).not.toHaveBeenCalled();
  });

  it("returns unknown instead of failed on network errors and clears inFlight", async () => {
    const invoice = readyInvoice();
    invoiceStore.set(invoice.id, invoice);
    postInvoice.mockRejectedValueOnce(new Error("Network down"));
    const outcome = await submitInvoice(client, invoice);
    expect(outcome.errors[0]).toMatch(/Network down/);
    expect(outcome.inFlight).toBe(false);
    expect(outcome.invoice.status).toBe("unknown");
    expect(invoiceStore.get(invoice.id)?.status).toBe("unknown");
    expect(invoiceStore.get(invoice.id)?.inFlight).toBe(false);
  });

  it("keeps a posted invoice posted when activity logging fails", async () => {
    const invoice = readyInvoice();
    invoiceStore.set(invoice.id, invoice);
    postInvoice.mockResolvedValueOnce(
      result({
        ok: true,
        code: "100",
        fiscalNumber: "9000052011142444901",
        kind: "success",
        raw: '{"Code":"100"}',
      }),
    );
    logEvent.mockRejectedValueOnce(new Error("IndexedDB full"));
    const outcome = await submitInvoice(client, invoice);
    expect(outcome.invoice.status).toBe("posted");
    expect(outcome.invoice.fiscalNumber).toBe("9000052011142444901");
    expect(outcome.invoice.postedEnvironment).toBe("sandbox");
    expect(outcome.invoice.postedPosId).toBe(client.posId);
    expect(invoiceStore.get(invoice.id)?.status).toBe("posted");
    expect(invoiceStore.get(invoice.id)?.fiscalNumber).toBe("9000052011142444901");
  });

  it("does not call PRA when a second submit sees the send lock", async () => {
    const invoice = readyInvoice({ inFlight: true });
    invoiceStore.set(invoice.id, invoice);
    const outcome = await submitInvoice(client, invoice);
    expect(outcome.inFlight).toBe(true);
    expect(postInvoice).not.toHaveBeenCalled();
  });

  it("clear send lock does not overwrite a row another tab just posted", async () => {
    const staleView = readyInvoice({ id: "inv_race", inFlight: true, inFlightAt: Date.now() });
    invoiceStore.set("inv_race", {
      ...postedInvoice(),
      id: "inv_race",
      usin: staleView.usin,
      inFlight: false,
      fiscalNumber: "9000052011142444901",
    });
    const next = await clearInvoiceInFlight(staleView);
    expect(next.status).toBe("posted");
    expect(next.fiscalNumber).toBe("9000052011142444901");
    expect(invoiceStore.get("inv_race")?.status).toBe("posted");
  });
});

describe("unknown reconcile and USIN lock", () => {
  it("stores unknown from an ambiguous PRA result and freezes USIN", () => {
    const next = applyPraResult(
      readyInvoice(),
      result({ ok: false, kind: "unknown", message: "gateway", nextAction: "check IRIS" }),
      client,
    );
    expect(next.status).toBe("unknown");
    expect(usinLocked(next)).toBe(true);
    expect(canRemoveInvoice(next)).toBe(false);
  });

  it("blocks a second post while status is unknown", async () => {
    const invoice = readyInvoice({ status: "unknown", attemptCount: 1 });
    invoiceStore.set(invoice.id, invoice);
    const outcome = await submitInvoice(client, invoice);
    expect(outcome.errors[0]).toMatch(/unclear/i);
    expect(postInvoice).not.toHaveBeenCalled();
  });

  it("reconciles unclear as posted with a fiscal number", async () => {
    const invoice = readyInvoice({ status: "unknown", attemptCount: 1, lastError: "timeout" });
    invoiceStore.set(invoice.id, invoice);
    const next = await reconcileInvoicePosted(client, invoice, "9000052011142444901");
    expect(next.status).toBe("posted");
    expect(next.fiscalNumber).toBe("9000052011142444901");
    expect(next.postedEnvironment).toBe("sandbox");
  });

  it("reconciles unclear as not posted so retry is allowed", async () => {
    const invoice = readyInvoice({ status: "unknown", attemptCount: 1 });
    invoiceStore.set(invoice.id, invoice);
    const next = await reconcileInvoiceNotPosted(invoice);
    expect(next.status).toBe("failed");
    expect(canRemoveInvoice(next)).toBe(true);
    expect(usinLocked(next)).toBe(false);
  });

  it("refuses to delete an unclear invoice", async () => {
    const invoice = readyInvoice({ status: "unknown", attemptCount: 1 });
    invoiceStore.set(invoice.id, invoice);
    await expect(removeInvoiceDraft(invoice)).rejects.toThrow(/Reconcile/);
    expect(invoiceStore.has(invoice.id)).toBe(true);
  });
});

describe("excel import discount", () => {
  it("applies HeaderDiscount to the invoice header and bill amount", async () => {
    parseSalesWorkbook.mockResolvedValueOnce([
      {
        USIN: "DFT-IMP-1",
        DateTime: "2026-09-14 10:00:00",
        InvoiceType: 1,
        PaymentMode: 1,
        BuyerName: "Buyer",
        BuyerPNTN: "",
        BuyerCNIC: "",
        BuyerPhone: "",
        ItemCode: "IT_001",
        ItemName: "Fee",
        Quantity: 1,
        PCTCode: "00000000",
        TaxRate: 16,
        SaleValue: 10000,
        Discount: 0,
        FurtherTax: 0,
        RefUSIN: "",
        HeaderDiscount: 100,
      },
    ]);
    const count = await importSalesFile(client, { arrayBuffer: async () => new ArrayBuffer(0) } as File);
    expect(count).toBe(1);
    const imported = [...invoiceStore.values()][0];
    expect(imported?.discount).toBe(100);
    expect(imported?.furtherTax).toBe(0);
    expect(imported?.totalBillAmount).toBe(totalsFromItems(imported?.items ?? [], 100).totalBillAmount);
  });

  it("previewSalesImport flags bad PCT and a duplicate USIN without saving", async () => {
    invoiceStore.set("inv_dup", readyInvoice({ id: "inv_dup", usin: "DFT-DUP-1" }));
    parseSalesWorkbook.mockResolvedValueOnce([
      {
        USIN: "DFT-BAD-PCT",
        DateTime: "2026-09-14 10:00:00",
        InvoiceType: 1,
        PaymentMode: 1,
        BuyerName: "",
        BuyerPNTN: "",
        BuyerCNIC: "",
        BuyerPhone: "",
        ItemCode: "IT_001",
        ItemName: "",
        Quantity: 1,
        PCTCode: "12",
        TaxRate: 16,
        SaleValue: 1000,
        Discount: 0,
        FurtherTax: 0,
        RefUSIN: "",
      },
      {
        USIN: "DFT-DUP-1",
        DateTime: "2026-09-14 10:00:00",
        InvoiceType: 1,
        PaymentMode: 1,
        BuyerName: "Buyer",
        BuyerPNTN: "",
        BuyerCNIC: "",
        BuyerPhone: "",
        ItemCode: "IT_001",
        ItemName: "Fee",
        Quantity: 1,
        PCTCode: "00000000",
        TaxRate: 16,
        SaleValue: 1000,
        Discount: 0,
        FurtherTax: 0,
        RefUSIN: "",
      },
      {
        USIN: "DFT-GOOD-1",
        DateTime: "2026-09-14 10:00:00",
        InvoiceType: 1,
        PaymentMode: 1,
        BuyerName: "Buyer",
        BuyerPNTN: "",
        BuyerCNIC: "",
        BuyerPhone: "",
        ItemCode: "IT_001",
        ItemName: "Fee",
        Quantity: 1,
        PCTCode: "00000000",
        TaxRate: 16,
        SaleValue: 1000,
        Discount: 0,
        FurtherTax: 0,
        RefUSIN: "",
      },
    ]);
    const preview = await previewSalesImport(client, { arrayBuffer: async () => new ArrayBuffer(0) } as File);
    const bad = preview.rows.find((row) => row.usin === "DFT-BAD-PCT");
    const dup = preview.rows.find((row) => row.usin === "DFT-DUP-1");
    const good = preview.rows.find((row) => row.usin === "DFT-GOOD-1");
    expect(bad?.errors.join(" ")).toMatch(/PCT|name/i);
    expect(dup?.errors).toContain("This USIN already exists in this client file.");
    expect(good?.errors).toEqual([]);
    expect(invoiceStore.has(good?.draft?.id ?? "")).toBe(false);
  });

  it("commitSalesImport writes only error-free drafts", async () => {
    const good = {
      ...readyInvoice({ id: "inv_ok", usin: "DFT-COMMIT-OK", status: "draft", fiscalNumber: "" }),
    };
    const bad = {
      ...readyInvoice({
        id: "inv_bad",
        usin: "DFT-COMMIT-BAD",
        status: "draft",
        fiscalNumber: "",
        items: [],
      }),
    };
    const result = await commitSalesImport(client, [good, bad]);
    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(1);
    expect(invoiceStore.get("inv_ok")?.usin).toBe("DFT-COMMIT-OK");
    expect(invoiceStore.get("inv_bad")).toBeUndefined();
  });
});
