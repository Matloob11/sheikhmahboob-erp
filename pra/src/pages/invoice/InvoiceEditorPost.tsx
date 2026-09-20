import { Panel } from "../../components/Panel";
import { canRemoveInvoice } from "../../domain/invoices";
import type { Client, Invoice } from "../../types";

type InvoiceEditorPostProps = {
  invoice: Invoice;
  owner: Client;
  locked: boolean;
  sending: boolean;
  busy: boolean;
  showPayload: boolean;
  onSetShowPayload: (value: boolean | ((current: boolean) => boolean)) => void;
  onSaveDraft: () => void;
  onValidateOnly: () => void;
  onRequestPost: () => void;
  onStartAdjust: (invoiceType: 2 | 3) => void;
  onClearInFlight: () => void;
  onCloneDraft: () => void;
  onUseWorkingMonth: () => void;
  onConfirmRemove: () => void;
};

export function InvoiceEditorPost({
  invoice,
  owner,
  locked,
  sending,
  busy,
  showPayload,
  onSetShowPayload,
  onSaveDraft,
  onValidateOnly,
  onRequestPost,
  onStartAdjust,
  onClearInFlight,
  onCloneDraft,
  onUseWorkingMonth,
  onConfirmRemove,
}: InvoiceEditorPostProps) {
  return (
    <div className="editor-span no-print" id="invoice-post">
      <Panel title="4 · Post">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <p className="muted" style={{ margin: 0 }}>
            PRA attempts: {invoice.attemptCount || 0}
            {invoice.lastCode ? ` · code ${invoice.lastCode}` : ""}
          </p>
          {invoice.lastResponse ? (
            <button className="btn ghost" type="button" onClick={() => onSetShowPayload((value) => !value)}>
              {showPayload ? "Hide PRA response" : "Show PRA response"}
            </button>
          ) : null}
        </div>
        {showPayload && invoice.lastResponse ? <pre className="payload mono">{invoice.lastResponse}</pre> : null}
        <div className="editor-actions" style={{ marginTop: 16 }}>
          <button className="btn ghost" type="button" disabled={locked || sending} onClick={onSaveDraft}>
            Save draft
          </button>
          <button className="btn ghost" type="button" disabled={locked || sending} onClick={onValidateOnly}>
            Validate locally
          </button>
          <button
            className="btn stamp"
            type="button"
            disabled={sending || locked}
            aria-busy={sending}
            onClick={onRequestPost}
          >
            {sending ? <span className="editor-spin" aria-hidden="true" /> : null}
            {sending ? "Posting…" : owner.environment === "production" ? "Post to production" : "Post to sandbox"}
          </button>
          {locked ? (
            <>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => onStartAdjust(3)}>
                Credit this invoice
              </button>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => onStartAdjust(2)}>
                Debit this invoice
              </button>
            </>
          ) : null}
          {invoice.inFlight && !busy ? (
            <button className="btn ghost" type="button" onClick={onClearInFlight}>
              Clear send lock
            </button>
          ) : null}
          <button className="btn ghost" type="button" onClick={onCloneDraft}>
            Clone as draft
          </button>
          <button className="btn ghost" type="button" disabled={locked} onClick={onUseWorkingMonth}>
            Use working month
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={!canRemoveInvoice(invoice) || sending}
            onClick={onConfirmRemove}
          >
            Remove draft
          </button>
        </div>
      </Panel>
    </div>
  );
}
