import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "../components/Badge";
import { BuyerPicker } from "../components/BuyerPicker";
import { Confirm } from "../components/Confirm";
import { EmptyState } from "../components/EmptyState";
import { AmountInput, SelectField, TextInput } from "../components/Field";
import { InvoicePrint, printInvoice } from "../components/InvoicePrint";
import { Skeleton } from "../components/Skeleton";
import { ItemPicker, PctPicker } from "../components/ItemPicker";
import { NeedClient } from "../components/NeedClient";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import { db, emptyInvoice } from "../db";
import { applyBuyerToInvoice, buyerDraftFromInvoice, saveBuyer } from "../domain/buyers";
import { applyItemToLine, applyPctToLine, resolveTaxDefaults } from "../domain/catalog";
import {
  cloneInvoiceDraft,
  composeInvoiceDateTime,
  createAdjustmentDraft,
  inferBuyerKind,
  posChecks,
  splitInvoiceDateTime,
  type AdjustmentPick,
  canRemoveInvoice,
  clearInvoiceInFlight,
  reconcileInvoiceNotPosted,
  reconcileInvoicePosted,
  removeInvoiceDraft,
  saveInvoiceDraft,
  submitInvoice,
  usinLocked,
  validateInvoiceDraft,
} from "../domain/invoices";
import {
  INVOICE_STEPS,
  nextInvoiceStep,
  prevInvoiceStep,
  type InvoiceStep,
} from "../domain/deskChrome";
import { sectionPath } from "../domain/nav";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";
import { useLive } from "../hooks/useLive";
import { formatDateTime } from "../lib/format";
import { invoiceMailto, invoiceWhatsApp } from "../lib/shareInvoice";
import { newId, nextUsin, periodStamp } from "../lib/ids";
import { parseAmount, pkr } from "../lib/money";
import { postedMessage, recalcLine, totalsFromItems } from "../lib/pra";
import {
  BUYER_TYPES,
  INVOICE_TYPES,
  PAYMENT_MODES,
  type Buyer,
  type CatalogItem,
  type Invoice,
  type InvoiceLine,
  type InvoiceType,
  type PaymentMode,
  type PctCode,
} from "../types";

type AdjustPickState = { on: boolean; quantity: string; saleValue: string };

function hydrate(invoice: Invoice): Invoice {
  return {
    ...invoice,
    lastCode: invoice.lastCode ?? "",
    attemptCount: invoice.attemptCount ?? 0,
    inFlight: invoice.inFlight === true,
  };
}

function blankLine(index: number, defaults: { pctCode: string; taxRate: number }): InvoiceLine {
  return recalcLine({
    id: newId("ln"),
    itemCode: `IT_${String(index).padStart(3, "0")}`,
    itemName: "",
    quantity: 1,
    pctCode: defaults.pctCode,
    taxRate: defaults.taxRate,
    saleValue: 0,
    discount: 0,
    furtherTax: 0,
    taxCharged: 0,
    totalAmount: 0,
  });
}

export function InvoiceEditorPage() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const isNew = !invoiceId || invoiceId === "new";
  const { client: selected, clients, chooseClient, period } = useDesk();
  const { push } = useNotice();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [missing, setMissing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [adjustType, setAdjustType] = useState<2 | 3 | null>(null);
  const [adjustPicks, setAdjustPicks] = useState<Record<string, AdjustPickState>>({});
  const [showPayload, setShowPayload] = useState(false);
  const [step, setStep] = useState<InvoiceStep>("header");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [fiscalDraft, setFiscalDraft] = useState("");
  const postingRef = useRef(false);

  const owner = clients.find((row) => row.id === invoice?.clientId) ?? selected;
  const locked = invoice?.status === "posted";
  const unclear = invoice?.status === "unknown";
  const usinFrozen = invoice ? usinLocked(invoice) : false;
  const leaveGuard = useUnsavedGuard(dirty && !locked);
  const sending = Boolean(busy || invoice?.inFlight);
  const fileId = invoice?.clientId ?? selected?.id;
  const buyers = useLive(
    () => (fileId ? db.buyers.where("clientId").equals(fileId).toArray() : Promise.resolve([] as Buyer[])),
    [] as Buyer[],
    [fileId],
  );
  const catalogItems = useLive(
    () => (fileId ? db.items.where("clientId").equals(fileId).toArray() : Promise.resolve([] as CatalogItem[])),
    [] as CatalogItem[],
    [fileId],
  );
  const pctRates = useLive(() => db.pctCodes.orderBy("name").toArray(), [] as PctCode[], []);
  const taxDefaults = useMemo(() => resolveTaxDefaults(pctRates, catalogItems), [pctRates, catalogItems]);
  const checks = owner ? posChecks(owner) : [];
  const pickedBuyer = buyers.find((row) => row.id === invoice?.buyerId);
  const buyerKind = invoice ? inferBuyerKind(invoice, pickedBuyer) : "";
  const buyerKindLabel = BUYER_TYPES.find((row) => row.value === buyerKind)?.label ?? "Not set";
  const stamp = invoice ? splitInvoiceDateTime(invoice.dateTime) : { date: "", time: "00:00:00" };

  useEffect(() => {
    let active = true;
    async function load() {
      if (!isNew && invoiceId) {
        const found = await db.invoices.get(invoiceId);
        if (!active) return;
        if (!found) {
          setMissing(true);
          setInvoice(null);
          return;
        }
        setMissing(false);
        setInvoice(hydrate(found));
        if (found.clientId !== selected?.id) void chooseClient(found.clientId);
        return;
      }
      if (!selected) return;
      const existing = await db.invoices.where("clientId").equals(selected.id).toArray();
      const stamp = periodStamp(period);
      if (active) {
        setMissing(false);
        setInvoice(
          emptyInvoice(selected.id, nextUsin(selected.pntn, existing.map((row) => row.usin), stamp), stamp),
        );
      }
    }
    void load();
    return () => {
      active = false;
    };
    // chooseClient is unstable; only reload when the file, period or route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, isNew, selected?.id, selected?.pntn, period]);

  const saveDraft = useCallback(async () => {
    if (!invoice || !owner || locked || sending) return;
    const next = await saveInvoiceDraft(owner, invoice);
    setInvoice(hydrate(next));
    if (next.inFlight) {
      push("info", "This invoice is already being sent. Wait for PRA before saving.");
      return;
    }
    if (next.status === "posted") {
      push("info", "Already posted. Daftar will not change it.");
      return;
    }
    setDirty(false);
    push("good", "Draft saved on this computer.");
    if (isNew) navigate(sectionPath(`/invoices/${next.id}`), { replace: true });
  }, [invoice, owner, locked, sending, isNew, navigate, push]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!locked) void saveDraft();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, saveDraft]);

  const totals = useMemo(
    () => (invoice ? totalsFromItems(invoice.items, invoice.discount) : null),
    [invoice],
  );

  function patch(partial: Partial<Invoice>) {
    if (locked) return;
    setDirty(true);
    setInvoice((current) => (current ? { ...current, ...partial, updatedAt: Date.now() } : current));
  }

  function patchLine(id: string, partial: Partial<InvoiceLine>) {
    if (!invoice || locked) return;
    const items = invoice.items.map((line) =>
      line.id === id ? recalcLine({ ...line, ...partial }) : line,
    );
    patch({ items, ...totalsFromItems(items, invoice.discount) });
  }

  async function validateOnly() {
    if (!invoice || !owner || locked) return;
    const result = await validateInvoiceDraft(owner, invoice);
    setInvoice(hydrate(result.invoice));
    setErrors(result.errors);
    push(result.errors.length ? "bad" : "good", result.errors.length ? "Fix the items below." : "All checks passed. Ready to send.");
    if (isNew) navigate(sectionPath(`/invoices/${result.invoice.id}`), { replace: true });
  }

  async function postNow() {
    if (!invoice || !owner || locked || postingRef.current || invoice.inFlight) return;
    postingRef.current = true;
    setBusy(true);
    try {
      const result = await submitInvoice(owner, invoice);
      setInvoice(hydrate(result.invoice));
      setErrors(result.errors);
      if (result.alreadyPosted) {
        push("info", "Already posted. Daftar will not send it again.");
        return;
      }
      if (result.inFlight) {
        push("info", result.errors[0] ?? "This invoice is already being sent.");
        return;
      }
      if (result.alreadyExists) {
        push("info", result.errors[0] ?? "PRA already has this USIN. Daftar will not send it again.");
        return;
      }
      if (result.result?.ok) {
        push("good", postedMessage(result.invoice.fiscalNumber, owner.environment));
      } else if (result.errors.length) {
        push("bad", result.errors[0] ?? "PRA rejected the invoice.");
      }
      if (isNew) navigate(sectionPath(`/invoices/${result.invoice.id}`), { replace: true });
    } catch (error) {
      push("bad", error instanceof Error ? error.message : "Network error");
    } finally {
      postingRef.current = false;
      setBusy(false);
      setConfirmPost(false);
    }
  }

  function requestPost() {
    if (!owner || sending || locked) return;
    if (owner.environment === "production") {
      setConfirmPost(true);
      return;
    }
    void postNow();
  }

  function startAdjust(invoiceType: 2 | 3) {
    if (!invoice) return;
    setAdjustPicks(
      Object.fromEntries(
        invoice.items.map((line) => [
          line.id,
          { on: true, quantity: String(line.quantity), saleValue: String(line.saleValue) },
        ]),
      ),
    );
    setAdjustType(invoiceType);
  }

  function adjustmentPicks(): AdjustmentPick[] | undefined {
    if (!invoice) return undefined;
    const selected = invoice.items
      .filter((line) => adjustPicks[line.id]?.on)
      .map((line) => ({
        sourceLineId: line.id,
        quantity: parseAmount(adjustPicks[line.id]?.quantity ?? String(line.quantity)),
        saleValue: parseAmount(adjustPicks[line.id]?.saleValue ?? String(line.saleValue)),
      }));
    if (selected.length === 0) return [];
    if (selected.length === invoice.items.length) {
      const unchanged = selected.every((pick) => {
        const line = invoice.items.find((item) => item.id === pick.sourceLineId);
        return line && pick.quantity === line.quantity && pick.saleValue === line.saleValue;
      });
      if (unchanged) return undefined;
    }
    return selected;
  }

  async function openAdjustment(invoiceType: 2 | 3) {
    if (!invoice || !owner || invoice.status !== "posted") return;
    const picks = adjustmentPicks();
    if (picks && picks.length === 0) {
      push("bad", "Select at least one line to credit or debit.");
      return;
    }
    try {
      const draft = await createAdjustmentDraft(owner, invoice, invoiceType, picks);
      push("good", invoiceType === 3 ? "Credit note draft opened." : "Debit note draft opened.");
      setAdjustType(null);
      navigate(sectionPath(`/invoices/${draft.id}`));
    } catch (error) {
      push("bad", error instanceof Error ? error.message : "Could not open the note.");
      setAdjustType(null);
    }
  }

  if (!selected && !invoice) {
    return (
      <>
        {leaveGuard}
        <NeedClient title="Select a client" body="Open a taxpayer file, then write the invoice." />
      </>
    );
  }
  if (missing) {
    return (
      <>
        {leaveGuard}
        <EmptyState
          title="Invoice not found"
          body="That invoice is not in this browser."
          action={
            <Link className="btn ghost" to={sectionPath("/invoices")}>
              Back to list
            </Link>
          }
        />
      </>
    );
  }
  if (!invoice || !totals || !owner) {
    return (
      <>
        {leaveGuard}
        <Skeleton lines={6} />
      </>
    );
  }

  const rateHint =
    taxDefaults.pctCode !== "00000000"
      ? `${taxDefaults.pctCode} at ${taxDefaults.taxRate}%`
      : "16% until a catalog exists";

  return (
    <div className="stack">
      {leaveGuard}
      <PageHeader
        title={invoice.usin}
        description="Posted invoices stay locked. Extra tax and ref USIN sit under More."
        actions={
          <>
            <Badge tone={invoice.status}>{invoice.status}</Badge>
            <Badge tone={invoice.postedEnvironment ?? owner.environment}>
              {invoice.postedEnvironment ?? owner.environment}
            </Badge>
            <Link className="btn ghost" to={sectionPath("/invoices")}>
              Back
            </Link>
            <button className="btn ghost" type="button" disabled={locked || sending} onClick={() => void saveDraft()}>
              Save draft
            </button>
            <button className="btn ghost" type="button" disabled={locked || sending || unclear} onClick={() => void validateOnly()}>
              Validate
            </button>
            <button
              className="btn stamp"
              type="button"
              disabled={sending || locked || unclear}
              aria-busy={sending}
              onClick={requestPost}
            >
              {sending ? "Posting…" : owner.environment === "production" ? "Post live" : "Post to sandbox"}
            </button>
          </>
        }
      />

      {invoice.status === "failed" && invoice.lastError ? (
        <div className="alert bad">{invoice.lastError}</div>
      ) : null}
      {unclear ? (
        <div className="alert info">
          <strong>PRA result is unclear.</strong> Check IRIS → IMS Fiscal Report for USIN{" "}
          <span className="mono">{invoice.usin}</span> before posting again.
          {invoice.lastError ? <div>{invoice.lastError}</div> : null}
          <div className="form-grid" style={{ marginTop: 12 }}>
            <TextInput
              label="Fiscal number from IRIS"
              className="mono"
              value={fiscalDraft}
              onChange={(event) => setFiscalDraft(event.target.value)}
            />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn stamp"
              type="button"
              disabled={!owner || !fiscalDraft.trim()}
              onClick={() => {
                if (!owner) return;
                void reconcileInvoicePosted(owner, invoice, fiscalDraft)
                  .then((next) => {
                    setInvoice(hydrate(next));
                    setFiscalDraft("");
                    push("good", `Marked posted with fiscal ${next.fiscalNumber}.`);
                  })
                  .catch((error) =>
                    push("bad", error instanceof Error ? error.message : "Could not reconcile."),
                  );
              }}
            >
              It was posted
            </button>
            <button
              className="btn warn"
              type="button"
              onClick={() => {
                void reconcileInvoiceNotPosted(invoice)
                  .then((next) => {
                    setInvoice(hydrate(next));
                    push("info", "Marked not posted. You can fix and retry once.");
                  })
                  .catch((error) =>
                    push("bad", error instanceof Error ? error.message : "Could not reconcile."),
                  );
              }}
            >
              It was not posted
            </button>
          </div>
        </div>
      ) : null}
      {errors.length ? (
        <div className="alert bad">
          {errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      ) : null}
      {checks.filter((check) => check.tone === "bad").map((check) => (
        <div key={check.title} className={`alert ${check.tone}`}>
          <strong>{check.title}.</strong> {check.body}{" "}
          {check.tone === "info" ? (
            <a href="mailto:eims@pra.punjab.gov.pk">eims@pra.punjab.gov.pk</a>
          ) : null}
        </div>
      ))}
      {invoice.inFlight ? (
        <div className="alert info">This invoice is being sent to PRA. A second click will not post it again.</div>
      ) : null}
      {locked ? (
        <div className="alert good">
          Posted and locked. Use a credit or debit note to adjust it.
        </div>
      ) : null}

      <div className="editor-layout">
        <nav className="editor-steps-bar editor-span no-print" aria-label="Invoice steps">
          {INVOICE_STEPS.map((id, index) => (
            <button
              key={id}
              type="button"
              className={step === id ? "on" : undefined}
              onClick={() => setStep(id)}
            >
              <span className="n">{index + 1}</span>
              {id === "header" ? "Header" : id === "lines" ? "Lines" : id === "review" ? "Review" : "Post"}
            </button>
          ))}
        </nav>

        {step === "header" ? (
        <div className="editor-span no-print" id="invoice-header">
          <Panel title="1 · Header">
            <div className="form-grid">
              <TextInput
                label="USIN"
                className="mono"
                disabled={locked || usinFrozen}
                value={invoice.usin}
                onChange={(event) => patch({ usin: event.target.value })}
              />
              <TextInput
                label="Date"
                type="date"
                lang="en-GB"
                disabled={locked}
                value={stamp.date}
                onChange={(event) => patch({ dateTime: composeInvoiceDateTime(event.target.value, stamp.time) })}
              />
              <TextInput
                label="Time"
                type="time"
                step={1}
                className="mono"
                disabled={locked}
                value={stamp.time.slice(0, 8)}
                onChange={(event) => patch({ dateTime: composeInvoiceDateTime(stamp.date, event.target.value) })}
                hint="Stored as YYYY-MM-DD HH:MM:SS"
              />
              <SelectField
                label="Invoice type"
                disabled={locked}
                value={invoice.invoiceType}
                onChange={(event) => patch({ invoiceType: Number(event.target.value) as InvoiceType })}
              >
                {INVOICE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Payment mode"
                disabled={locked}
                value={invoice.paymentMode}
                onChange={(event) => patch({ paymentMode: Number(event.target.value) as PaymentMode })}
              >
                {PAYMENT_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </SelectField>
              <div className="form-span">
                <BuyerPicker
                  buyers={buyers}
                  disabled={locked}
                  onPick={(buyer) => patch(applyBuyerToInvoice(buyer))}
                />
              </div>
              <TextInput
                label="Buyer name"
                disabled={locked}
                value={invoice.buyerName}
                onChange={(event) => patch({ buyerName: event.target.value, buyerId: undefined })}
              />
              <TextInput
                label="Buyer PNTN"
                className="mono"
                disabled={locked}
                value={invoice.buyerPntn}
                onChange={(event) => patch({ buyerPntn: event.target.value })}
              />
              <TextInput
                label="Buyer CNIC"
                className="mono"
                disabled={locked}
                value={invoice.buyerCnic}
                onChange={(event) => patch({ buyerCnic: event.target.value })}
              />
              <TextInput
                label="Buyer phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                disabled={locked}
                value={invoice.buyerPhone}
                onChange={(event) => patch({ buyerPhone: event.target.value })}
              />
              <TextInput
                label="Buyer type"
                disabled
                value={buyerKindLabel}
                hint={pickedBuyer?.buyerType ? "From the buyer master" : "Inferred from PNTN / CNIC"}
                onChange={() => undefined}
              />
            </div>
            <details className="more-fields" open={showAdvanced} onToggle={(event) => setShowAdvanced(event.currentTarget.open)}>
              <summary>More header fields</summary>
              <div className="form-grid" style={{ marginTop: 12 }}>
              <TextInput
                label="Sale type"
                disabled={locked}
                value={invoice.saleType ?? "Services"}
                onChange={(event) => patch({ saleType: event.target.value })}
              />
              <TextInput
                label="Taxpayer type"
                disabled={locked}
                value={invoice.taxpayerType ?? ""}
                onChange={(event) => patch({ taxpayerType: event.target.value })}
              />
              <TextInput
                label="Buyer district"
                disabled={locked}
                value={invoice.buyerDistrict ?? ""}
                onChange={(event) => patch({ buyerDistrict: event.target.value })}
              />
              <AmountInput
                label="Extra tax"
                disabled={locked}
                value={invoice.extraTax ?? 0}
                onValueChange={(extraTax) => patch({ extraTax })}
              />
              <AmountInput
                label="ST withheld"
                disabled={locked}
                value={invoice.stWithheld ?? 0}
                onValueChange={(stWithheld) => patch({ stWithheld })}
              />
              <label className="row form-span">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={invoice.reverseCharge === true}
                  onChange={(event) => patch({ reverseCharge: event.target.checked })}
                />
                Reverse charge
              </label>
              <AmountInput
                label="Header discount"
                disabled={locked}
                value={invoice.discount}
                onValueChange={(discount) =>
                  patch({
                    discount,
                    ...totalsFromItems(invoice.items, discount),
                  })
                }
              />
              <TextInput
                label="Ref USIN (debit/credit)"
                className="mono"
                disabled={locked}
                value={invoice.refUsin}
                onChange={(event) => patch({ refUsin: event.target.value })}
              />
              </div>
            </details>
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="btn ghost"
                type="button"
                disabled={locked || !invoice.buyerName.trim()}
                onClick={() => {
                  void saveBuyer(owner.id, buyerDraftFromInvoice(invoice), invoice.buyerId).then((result) => {
                    if (result.errors.length) {
                      push("bad", result.errors[0] ?? "Could not save buyer.");
                      return;
                    }
                    patch(applyBuyerToInvoice(result.buyer));
                    push("good", `Saved buyer ${result.buyer.name}.`);
                  });
                }}
              >
                Save buyer to this file
              </button>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn stamp" type="button" onClick={() => setStep(nextInvoiceStep(step))}>
                Continue to lines
              </button>
            </div>
          </Panel>
        </div>
        ) : null}

        {step === "lines" ? (
        <div className="editor-span no-print" id="invoice-lines">
          <Panel
            title="2 · Lines"
            actions={
              <button
                className="btn ghost"
                type="button"
                disabled={locked}
                onClick={() => {
                  const items = [...invoice.items, blankLine(invoice.items.length + 1, taxDefaults)];
                  patch({ items, ...totalsFromItems(items, invoice.discount) });
                }}
              >
                Add line
              </button>
            }
          >
            <div className="picker-row">
              <ItemPicker
                items={catalogItems}
                disabled={locked}
                onPick={(item) => {
                  const next = applyItemToLine(blankLine(invoice.items.length + 1, taxDefaults), item);
                  const items = [...invoice.items, recalcLine(next)];
                  patch({ items, ...totalsFromItems(items, invoice.discount) });
                }}
              />
              <PctPicker
                rates={pctRates}
                disabled={locked}
                onPick={(rate) => {
                  const next = applyPctToLine(blankLine(invoice.items.length + 1, taxDefaults), rate);
                  const items = [...invoice.items, recalcLine(next)];
                  patch({ items, ...totalsFromItems(items, invoice.discount) });
                }}
              />
            </div>
            <div className="table-wrap">
              <table className="line-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Qty</th>
                    <th>PCT</th>
                    <th>Rate %</th>
                    <th>Sale value</th>
                    <th>Discount</th>
                    <th>Further tax</th>
                    <th>Tax</th>
                    <th>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((line) => (
                    <tr key={line.id}>
                      <td data-label="Code">
                        <input
                          className="mono"
                          disabled={locked}
                          aria-label={`Item code ${line.itemCode || "line"}`}
                          value={line.itemCode}
                          onChange={(event) => patchLine(line.id, { itemCode: event.target.value })}
                        />
                      </td>
                      <td data-label="Name">
                        <input
                          disabled={locked}
                          aria-label={`Item name ${line.itemCode || "line"}`}
                          value={line.itemName}
                          onChange={(event) => patchLine(line.id, { itemName: event.target.value })}
                        />
                      </td>
                      <td data-label="Qty">
                        <AmountInput
                          disabled={locked}
                          aria-label={`Quantity ${line.itemCode || "line"}`}
                          value={line.quantity}
                          onValueChange={(quantity) => patchLine(line.id, { quantity })}
                        />
                      </td>
                      <td data-label="PCT code">
                        <input
                          className="mono"
                          disabled={locked}
                          aria-label={`PCT code ${line.itemCode || "line"}`}
                          value={line.pctCode}
                          onChange={(event) => patchLine(line.id, { pctCode: event.target.value })}
                        />
                      </td>
                      <td data-label="Rate %">
                        <AmountInput
                          disabled={locked}
                          aria-label={`Tax rate ${line.itemCode || "line"}`}
                          value={line.taxRate}
                          onValueChange={(taxRate) => patchLine(line.id, { taxRate })}
                        />
                      </td>
                      <td data-label="Sale value">
                        <AmountInput
                          disabled={locked}
                          aria-label={`Sale value ${line.itemCode || "line"}`}
                          value={line.saleValue}
                          onValueChange={(saleValue) => patchLine(line.id, { saleValue })}
                        />
                      </td>
                      <td data-label="Discount">
                        <AmountInput
                          disabled={locked}
                          aria-label={`Line discount ${line.itemCode}`}
                          value={line.discount}
                          onValueChange={(discount) => patchLine(line.id, { discount })}
                        />
                      </td>
                      <td data-label="Further tax">
                        <AmountInput
                          disabled={locked}
                          aria-label={`Further tax ${line.itemCode || "line"}`}
                          value={line.furtherTax}
                          onValueChange={(furtherTax) => patchLine(line.id, { furtherTax })}
                        />
                      </td>
                      <td className="mono" data-label="Tax">{pkr(line.taxCharged)}</td>
                      <td className="mono" data-label="Total">{pkr(line.totalAmount)}</td>
                      <td className="line-remove">
                        <button
                          className="btn ghost"
                          type="button"
                          disabled={locked}
                          onClick={() => {
                            const items = invoice.items.filter((item) => item.id !== line.id);
                            patch({ items, ...totalsFromItems(items, invoice.discount) });
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {invoice.items.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="muted">
                        Add a line or pick an item / PCT. New lines use the catalog rate ({rateHint}).
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn ghost" type="button" onClick={() => setStep(prevInvoiceStep(step))}>
                Back
              </button>
              <button className="btn stamp" type="button" onClick={() => setStep(nextInvoiceStep(step))}>
                Continue to review
              </button>
            </div>
          </Panel>
        </div>
        ) : null}

        {step === "review" || step === "post" ? (
        <div className="no-print" id="invoice-review">
          <Panel title="3 · Review">
            <article className="metric">
              <span>Sale value</span>
              <b>{pkr(totals.totalSaleValue)}</b>
            </article>
            <article className="metric" style={{ marginTop: 12 }}>
              <span>Tax charged</span>
              <b>{pkr(totals.totalTaxCharged)}</b>
            </article>
            <article className="metric" style={{ marginTop: 12 }}>
              <span>Further tax</span>
              <b>{pkr(totals.furtherTax)}</b>
            </article>
            <article className="metric" style={{ marginTop: 12 }}>
              <span>Bill amount</span>
              <b>{pkr(totals.totalBillAmount)}</b>
            </article>
            <p className="muted" style={{ margin: "16px 0 0" }}>
              Extra tax {pkr(invoice.extraTax ?? 0)} · ST withheld {pkr(invoice.stWithheld ?? 0)} · Reverse
              charge {invoice.reverseCharge ? "yes" : "no"}
              {invoice.saleType ? ` · ${invoice.saleType}` : ""}
              {invoice.buyerDistrict ? ` · ${invoice.buyerDistrict}` : ""}
            </p>
            {invoice.fiscalNumber ? (
              <>
                <p className="mono" style={{ fontSize: "1.15rem", margin: "16px 0 8px" }}>
                  {invoice.fiscalNumber}
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  {postedMessage(invoice.fiscalNumber, owner.environment)}
                </p>
              </>
            ) : null}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn ghost" type="button" onClick={() => setStep("lines")}>
                Back to lines
              </button>
              <button className="btn stamp" type="button" onClick={() => setStep("post")}>
                Continue to post
              </button>
            </div>
          </Panel>
        </div>
        ) : null}

        {step === "review" || step === "post" ? (
        <aside className="editor-aside">
          <InvoicePrint invoice={invoice} client={owner} />
          <div className="editor-actions no-print">
            <button className="btn ghost" type="button" onClick={() => printInvoice("a4")}>
              {locked ? "Print A4" : "Preview / print draft"}
            </button>
            <button className="btn ghost" type="button" onClick={() => printInvoice("thermal")}>
              Print 80mm
            </button>
            <a className="btn ghost" href={invoiceMailto(invoice, owner)}>
              Email summary
            </a>
            <a className="btn ghost" href={invoiceWhatsApp(invoice, owner, invoice.buyerPhone)} target="_blank" rel="noreferrer">
              WhatsApp summary
            </a>
          </div>
        </aside>
        ) : null}

        {step === "post" ? (
        <div className="editor-span no-print" id="invoice-post">
          <Panel title="4 · Post">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <p className="muted" style={{ margin: 0 }}>
                PRA attempts: {invoice.attemptCount || 0}
                {invoice.lastCode ? ` · code ${invoice.lastCode}` : ""}
              </p>
              {invoice.lastResponse ? (
                <button className="btn ghost" type="button" onClick={() => setShowPayload((value) => !value)}>
                  {showPayload ? "Hide PRA response" : "Show PRA response"}
                </button>
              ) : null}
            </div>
            {showPayload && invoice.lastResponse ? <pre className="payload mono">{invoice.lastResponse}</pre> : null}
            <div className="editor-actions" style={{ marginTop: 16 }}>
              <button className="btn ghost" type="button" disabled={locked || sending} onClick={() => void saveDraft()}>
                Save draft
              </button>
              <button className="btn ghost" type="button" disabled={locked || sending} onClick={() => void validateOnly()}>
                Validate locally
              </button>
              <button
                className="btn stamp"
                type="button"
                disabled={sending || locked}
                aria-busy={sending}
                onClick={requestPost}
              >
                {sending ? <span className="editor-spin" aria-hidden="true" /> : null}
                {sending ? "Posting…" : owner.environment === "production" ? "Post to production" : "Post to sandbox"}
              </button>
              {locked ? (
                <>
                  <button className="btn ghost" type="button" disabled={busy} onClick={() => startAdjust(3)}>
                    Credit this invoice
                  </button>
                  <button className="btn ghost" type="button" disabled={busy} onClick={() => startAdjust(2)}>
                    Debit this invoice
                  </button>
                </>
              ) : null}
              {invoice.inFlight && !busy ? (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    void clearInvoiceInFlight(invoice).then((next) => {
                      setInvoice(hydrate(next));
                      push("info", "Send lock cleared. Confirm this USIN is not already on PRA before retrying.");
                    });
                  }}
                >
                  Clear send lock
                </button>
              ) : null}
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  void cloneInvoiceDraft(owner, invoice).then((next) => {
                    push("good", `Opened draft ${next.usin}.`);
                    navigate(sectionPath(`/invoices/${next.id}`));
                  });
                }}
              >
                Clone as draft
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={locked}
                onClick={() => patch({ dateTime: formatDateTime(periodStamp(period)) })}
              >
                Use working month
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={!canRemoveInvoice(invoice) || sending}
                onClick={() => setConfirmRemove(true)}
              >
                Remove draft
              </button>
            </div>
          </Panel>
        </div>
        ) : null}
      </div>

      <Confirm
        open={confirmPost}
        danger
        title={`Post live for ${owner.businessName}?`}
        body={
          <>
            <p>
              {owner.businessName} · {owner.environment}
            </p>
            <p className="mono">
              USIN {invoice.usin} · {pkr(totals.totalBillAmount)}
            </p>
            <p>This sends the invoice to PRA production. Daftar cannot undo that from here.</p>
          </>
        }
        confirmLabel="Post to production"
        onCancel={() => setConfirmPost(false)}
        onConfirm={() => void postNow()}
      />
      <Confirm
        open={adjustType !== null}
        title={adjustType === 3 ? `Credit ${invoice.usin}?` : `Debit ${invoice.usin}?`}
        body={
          <>
            <p>Ref USIN stays the posted USIN. Untick lines or change qty / sale value for a partial note.</p>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Sale</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((line) => {
                    const pick = adjustPicks[line.id] ?? {
                      on: true,
                      quantity: String(line.quantity),
                      saleValue: String(line.saleValue),
                    };
                    return (
                      <tr key={line.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Include ${line.itemName || line.itemCode}`}
                            checked={pick.on}
                            onChange={(event) =>
                              setAdjustPicks((current) => ({
                                ...current,
                                [line.id]: { ...pick, on: event.target.checked },
                              }))
                            }
                          />
                        </td>
                        <td>
                          {line.itemName || line.itemCode}
                          <div className="muted mono">{line.pctCode}</div>
                        </td>
                        <td>
                          <input
                            aria-label={`Quantity ${line.itemCode}`}
                            value={pick.quantity}
                            onChange={(event) =>
                              setAdjustPicks((current) => ({
                                ...current,
                                [line.id]: { ...pick, quantity: event.target.value },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Sale value ${line.itemCode}`}
                            value={pick.saleValue}
                            onChange={(event) =>
                              setAdjustPicks((current) => ({
                                ...current,
                                [line.id]: { ...pick, saleValue: event.target.value },
                              }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        }
        confirmLabel={adjustType === 3 ? "Open credit note" : "Open debit note"}
        onCancel={() => setAdjustType(null)}
        onConfirm={() => {
          if (adjustType) void openAdjustment(adjustType);
        }}
      />
      <Confirm
        open={confirmRemove}
        danger
        title={`Remove ${invoice.usin}?`}
        body="This deletes the draft from this computer. Posted invoices cannot be removed."
        confirmLabel="Remove draft"
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          void (async () => {
            try {
              await removeInvoiceDraft(invoice);
              push("info", "Draft removed.");
              navigate(sectionPath("/invoices"));
            } catch (error) {
              push("bad", error instanceof Error ? error.message : "Could not remove invoice.");
              setConfirmRemove(false);
            }
          })();
        }}
      />
    </div>
  );
}
