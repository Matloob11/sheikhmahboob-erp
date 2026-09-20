import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BuyerPicker } from "../components/BuyerPicker";
import { Confirm } from "../components/Confirm";
import { AmountInput, TextInput } from "../components/Field";
import { InvoicePrint, printInvoice } from "../components/InvoicePrint";
import { ItemPicker, PctPicker } from "../components/ItemPicker";
import { NeedClient } from "../components/NeedClient";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import { db, emptyInvoice } from "../db";
import { applyBuyerToInvoice } from "../domain/buyers";
import { applyItemToLine, applyPctToLine, resolveTaxDefaults } from "../domain/catalog";
import { inferBuyerKind, posChecks, saveInvoiceDraft, submitInvoice } from "../domain/invoices";
import { sectionPath } from "../domain/nav";
import { useLive } from "../hooks/useLive";
import { newId, nextUsin, periodStamp } from "../lib/ids";
import { pkr } from "../lib/money";
import { postedMessage, recalcLine, totalsFromItems } from "../lib/pra";
import type { Buyer, CatalogItem, Invoice, InvoiceLine, PctCode } from "../types";

function blankLine(defaults: { pctCode: string; taxRate: number }): InvoiceLine {
  return recalcLine({
    id: newId("ln"),
    itemCode: "IT_001",
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

export function PosSalePage() {
  const { client: selected, period } = useDesk();
  const { push } = useNotice();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);
  const postingRef = useRef(false);

  const buyers = useLive(
    () =>
      selected ? db.buyers.where("clientId").equals(selected.id).toArray() : Promise.resolve([] as Buyer[]),
    [] as Buyer[],
    [selected?.id],
  );
  const catalogItems = useLive(
    () =>
      selected ? db.items.where("clientId").equals(selected.id).toArray() : Promise.resolve([] as CatalogItem[]),
    [] as CatalogItem[],
    [selected?.id],
  );
  const pctRates = useLive(() => db.pctCodes.orderBy("name").toArray(), [] as PctCode[], []);
  const activeItems = catalogItems.filter((row) => !row.inactive);
  const taxDefaults = useMemo(() => resolveTaxDefaults(pctRates, activeItems), [pctRates, activeItems]);
  const checks = selected ? posChecks(selected) : [];
  const line = invoice?.items[0];
  const totals = invoice ? totalsFromItems(invoice.items) : null;
  const locked = invoice?.status === "posted";
  const sending = Boolean(busy || invoice?.inFlight);
  const pickedBuyer = buyers.find((row) => row.id === invoice?.buyerId);
  const walkIn = invoice ? inferBuyerKind(invoice, pickedBuyer) || (invoice.buyerPntn.trim() ? "registered" : "end_consumer") : "";

  const startSale = useCallback(async () => {
    if (!selected) return;
    const existing = await db.invoices.where("clientId").equals(selected.id).toArray();
    const stamp = periodStamp(period);
    const draft = emptyInvoice(selected.id, nextUsin(selected.pntn, existing.map((row) => row.usin), stamp), stamp);
    draft.paymentMode = 1;
    draft.invoiceType = 1;
    draft.items = [blankLine(taxDefaults)];
    setInvoice(draft);
    setErrors([]);
  }, [selected, period, taxDefaults]);

  useEffect(() => {
    if (!selected) {
      setInvoice(null);
      return;
    }
    void startSale();
    // Restart only when the open file or working period changes — not when the PCT catalog hydrates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, period]);

  function patch(partial: Partial<Invoice>) {
    if (!invoice || locked) return;
    setInvoice({ ...invoice, ...partial, updatedAt: Date.now() });
  }

  function patchLine(partial: Partial<InvoiceLine>) {
    if (!invoice || !line || locked) return;
    const next = recalcLine({ ...line, ...partial });
    patch({ items: [next] });
  }

  async function send() {
    if (!selected || !invoice || sending || locked || postingRef.current || invoice.inFlight) return;
    postingRef.current = true;
    setBusy(true);
    try {
      const saved = await saveInvoiceDraft(selected, invoice);
      const result = await submitInvoice(selected, saved);
      setInvoice(result.invoice);
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
        push("info", result.errors[0] ?? "PRA already has this USIN.");
        return;
      }
      if (result.result?.ok) {
        push(
          "good",
          postedMessage(
            result.invoice.fiscalNumber,
            result.invoice.postedEnvironment ?? selected.environment,
          ),
        );
      } else if (result.errors.length) {
        push("bad", result.errors[0] ?? "PRA rejected the invoice.");
      }
    } catch (error) {
      push("bad", error instanceof Error ? error.message : "Could not post this sale.");
    } finally {
      postingRef.current = false;
      setBusy(false);
      setConfirmPost(false);
    }
  }

  function requestSend() {
    if (!selected || sending || locked) return;
    if (selected.environment === "production") {
      setConfirmPost(true);
      return;
    }
    void send();
  }

  if (!selected) {
    return <NeedClient title="Select a client for POS sale" body="Fast cash sale posts through the same eIMS path as the invoice editor." />;
  }

  if (!invoice || !line) {
    return <p className="muted">Building a cash draft on this file.</p>;
  }

  return (
    <div className="stack pos-page">
      <PageHeader
        kicker="POS"
        title="Fast cash sale"
        actions={
          <Link className="btn ghost" to={sectionPath("/invoices/new")}>
            Full invoice
          </Link>
        }
      />
      {checks.filter((check) => check.tone === "bad").map((check) => (
        <Notice key={check.title} tone={check.tone === "bad" ? "bad" : "info"}>
          <strong>{check.title}.</strong> {check.body}
        </Notice>
      ))}
      {errors.length ? (
        <Notice tone="bad">
          {errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </Notice>
      ) : null}
      {locked ? (
        <Notice tone="good">
          {postedMessage(invoice.fiscalNumber, selected.environment)} Code {invoice.lastCode || "—"}.{" "}
          <Link to={sectionPath(`/invoices/${invoice.id}`)}>Open invoice</Link>
        </Notice>
      ) : null}

      <Panel title="Sale">
        <div className="form-grid">
          <TextInput label="USIN" className="mono" value={invoice.usin} disabled />
          <TextInput label="Payment" value="Cash" disabled />
          <TextInput
            label="Buyer type"
            value={walkIn === "end_consumer" ? "End consumer" : walkIn || "End consumer"}
            hint="Walk-in defaults to end consumer when there is no PNTN."
            disabled
          />
          <div className="form-span">
            <BuyerPicker
              buyers={buyers}
              disabled={locked || sending}
              onPick={(buyer) => patch(applyBuyerToInvoice(buyer))}
            />
          </div>
          <TextInput
            label="Buyer name"
            value={invoice.buyerName}
            disabled={locked || sending}
            onChange={(event) => patch({ buyerName: event.target.value, buyerId: undefined })}
          />
          <div className="form-span">
            <ItemPicker
              items={activeItems}
              disabled={locked || sending}
              onPick={(item) =>
                patchLine({
                  ...applyItemToLine(line, item),
                  quantity: item.defaultQty && item.defaultQty > 0 ? item.defaultQty : line.quantity,
                })
              }
            />
          </div>
          <div className="form-span">
            <PctPicker
              rates={pctRates}
              disabled={locked || sending}
              onPick={(rate) => patchLine(applyPctToLine(line, rate))}
            />
          </div>
          <TextInput
            label="Item name"
            value={line.itemName}
            disabled={locked || sending}
            onChange={(event) => patchLine({ itemName: event.target.value })}
          />
          <AmountInput
            label="Quantity"
            value={line.quantity}
            disabled={locked || sending}
            onValueChange={(quantity) => patchLine({ quantity: quantity || 0 })}
          />
          <AmountInput
            label="Sale value (ex-ST)"
            value={line.saleValue}
            disabled={locked || sending}
            onValueChange={(saleValue) => patchLine({ saleValue })}
          />
          <TextInput label="Tax" value={pkr(totals?.totalTaxCharged ?? 0)} disabled />
          <TextInput label="Bill" value={pkr(totals?.totalBillAmount ?? 0)} disabled />
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn stamp" type="button" disabled={locked || sending} onClick={requestSend}>
            {sending ? "Posting…" : "Post cash sale"}
          </button>
          {locked ? (
            <>
              <button className="btn ghost" type="button" onClick={() => printInvoice("thermal")}>
                Print receipt
              </button>
              <button className="btn ghost" type="button" onClick={() => void startSale()}>
                New sale
              </button>
            </>
          ) : null}
        </div>
      </Panel>

      {locked ? (
        <div className="pos-receipt" aria-hidden="true">
          <InvoicePrint invoice={invoice} client={selected} />
        </div>
      ) : null}

      <Confirm
        open={confirmPost}
        title="Post this live eIMS sale?"
        body="This client is live. The sale goes to PRA as a real tax invoice and cannot be undone here."
        confirmLabel="Post live"
        danger
        onConfirm={() => void send()}
        onCancel={() => setConfirmPost(false)}
      />
    </div>
  );
}
