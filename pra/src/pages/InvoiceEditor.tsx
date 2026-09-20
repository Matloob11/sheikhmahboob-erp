import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Confirm } from "../components/Confirm";
import { EmptyState } from "../components/EmptyState";
import { TextInput } from "../components/Field";
import { InvoicePrint, printInvoice } from "../components/InvoicePrint";
import { Skeleton } from "../components/Skeleton";
import { NeedClient } from "../components/NeedClient";
import { PageHeader } from "../components/PageHeader";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import { db, emptyInvoice } from "../db";
import { resolveTaxDefaults } from "../domain/catalog";
import {
  cloneInvoiceDraft,
  composeInvoiceDateTime,
  createAdjustmentDraft,
  inferBuyerKind,
  posChecks,
  splitInvoiceDateTime,
  type AdjustmentPick,
  clearInvoiceInFlight,
  reconcileInvoiceNotPosted,
  reconcileInvoicePosted,
  removeInvoiceDraft,
  saveInvoiceDraft,
  submitInvoice,
  usinLocked,
  validateInvoiceDraft,
} from "../domain/invoices";
import { INVOICE_STEPS, type InvoiceStep } from "../domain/deskChrome";
import { sectionPath } from "../domain/nav";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";
import { useLive } from "../hooks/useLive";
import { formatDateTime } from "../lib/format";
import { focusFirstFieldError } from "../lib/fieldErrors";
import { invoiceMailto, invoiceWhatsApp } from "../lib/shareInvoice";
import { newId, nextUsin, periodStamp } from "../lib/ids";
import { parseAmount, pkr } from "../lib/money";
import { postedMessage, recalcLine, totalsForInvoice, totalsFromItems } from "../lib/pra";
import { environmentLabel, invoiceStatusLabel } from "../lib/statusLabel";
import {
  BUYER_TYPES,
  type Buyer,
  type CatalogItem,
  type Invoice,
  type InvoiceLine,
  type PctCode,
} from "../types";
import { InvoiceEditorHeader } from "./invoice/InvoiceEditorHeader";
import { InvoiceEditorLines } from "./invoice/InvoiceEditorLines";
import { InvoiceEditorPost } from "./invoice/InvoiceEditorPost";
import { InvoiceEditorReview } from "./invoice/InvoiceEditorReview";

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
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!locked) void saveDraft();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, saveDraft]);

  const totals = useMemo(
    () => (invoice ? totalsForInvoice(invoice) : null),
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
    patch({ items, ...totalsFromItems(items) });
  }

  async function validateOnly() {
    if (!invoice || !owner || locked) return;
    const result = await validateInvoiceDraft(owner, invoice);
    setInvoice(hydrate(result.invoice));
    setErrors(result.errors);
    push(result.errors.length ? "bad" : "good", result.errors.length ? "Fix the items below." : "All checks passed. Ready to send.");
    if (result.errors.length) {
      const needsLines = result.errors.some((row) => /^Line \d+:/i.test(row) || row.includes("at least one line"));
      if (needsLines) setStep("lines");
      else setStep("header");
      queueMicrotask(() => focusFirstFieldError(result.errors));
    }
    if (isNew) navigate(sectionPath(`/invoices/${result.invoice.id}`), { replace: true });
  }

  function addLine() {
    if (!invoice || locked) return;
    const items = [...invoice.items, blankLine(invoice.items.length + 1, taxDefaults)];
    patch({ items, ...totalsFromItems(items) });
  }

  function onLineKeyDown(event: KeyboardEvent<HTMLInputElement>, rowIndex: number, col: string) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      addLine();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const nextRow = event.key === "ArrowUp" ? rowIndex - 1 : rowIndex + 1;
    const target = document.querySelector<HTMLElement>(
      `[data-line-row="${nextRow}"][data-line-col="${col}"]`,
    );
    target?.focus();
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
            <Badge tone={invoice.status}>{invoiceStatusLabel(invoice.status, invoice.inFlight)}</Badge>
            <Badge tone={invoice.postedEnvironment ?? owner.environment}>
              {environmentLabel(invoice.postedEnvironment ?? owner.environment)}
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
        <div className="alert bad" data-invoice-errors tabIndex={-1}>
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
          <InvoiceEditorHeader
            invoice={invoice}
            owner={owner}
            buyers={buyers}
            errors={errors}
            locked={locked}
            usinFrozen={usinFrozen}
            stamp={stamp}
            pickedBuyer={pickedBuyer}
            buyerKindLabel={buyerKindLabel}
            showAdvanced={showAdvanced}
            step={step}
            onPatch={patch}
            onComposeDateTime={(date, time) => patch({ dateTime: composeInvoiceDateTime(date, time) })}
            onSetShowAdvanced={setShowAdvanced}
            onSetStep={setStep}
            onPush={push}
          />
        ) : null}

        {step === "lines" ? (
          <InvoiceEditorLines
            invoice={invoice}
            errors={errors}
            locked={locked}
            step={step}
            catalogItems={catalogItems}
            pctRates={pctRates}
            rateHint={rateHint}
            blankLine={(index) => blankLine(index, taxDefaults)}
            onPatch={patch}
            onPatchLine={patchLine}
            onAddLine={addLine}
            onLineKeyDown={onLineKeyDown}
            onSetStep={setStep}
          />
        ) : null}

        {step === "review" || step === "post" ? (
          <InvoiceEditorReview invoice={invoice} owner={owner} totals={totals} onSetStep={setStep} />
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
          <InvoiceEditorPost
            invoice={invoice}
            owner={owner}
            locked={locked}
            sending={sending}
            busy={busy}
            showPayload={showPayload}
            onSetShowPayload={setShowPayload}
            onSaveDraft={() => void saveDraft()}
            onValidateOnly={() => void validateOnly()}
            onRequestPost={requestPost}
            onStartAdjust={startAdjust}
            onClearInFlight={() => {
              void clearInvoiceInFlight(invoice).then((next) => {
                setInvoice(hydrate(next));
                push("info", "Send lock cleared. Confirm this USIN is not already on PRA before retrying.");
              });
            }}
            onCloneDraft={() => {
              void cloneInvoiceDraft(owner, invoice).then((next) => {
                push("good", `Opened draft ${next.usin}.`);
                navigate(sectionPath(`/invoices/${next.id}`));
              });
            }}
            onUseWorkingMonth={() => patch({ dateTime: formatDateTime(periodStamp(period)) })}
            onConfirmRemove={() => setConfirmRemove(true)}
          />
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
