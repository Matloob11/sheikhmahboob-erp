import { Panel } from "../../components/Panel";
import { pkr } from "../../lib/money";
import { postedMessage, totalsForInvoice } from "../../lib/pra";
import type { Client, Invoice } from "../../types";

type InvoiceEditorReviewProps = {
  invoice: Invoice;
  owner: Client;
  totals: ReturnType<typeof totalsForInvoice>;
  onSetStep: (step: "lines" | "post") => void;
};

export function InvoiceEditorReview({ invoice, owner, totals, onSetStep }: InvoiceEditorReviewProps) {
  return (
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
          Extra tax {pkr(invoice.extraTax ?? 0)} · ST withheld {pkr(invoice.stWithheld ?? 0)} · Reverse charge{" "}
          {invoice.reverseCharge ? "yes" : "no"}
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
          <button className="btn ghost" type="button" onClick={() => onSetStep("lines")}>
            Back to lines
          </button>
          <button className="btn stamp" type="button" onClick={() => onSetStep("post")}>
            Continue to post
          </button>
        </div>
      </Panel>
    </div>
  );
}
