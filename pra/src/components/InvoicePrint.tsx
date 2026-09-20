import { useDesk } from "../context/DeskContext";
import { printBanner, sellerPrintLines } from "../domain/print";
import { pkr } from "../lib/money";
import { INVOICE_TYPES, PAYMENT_MODES, type Client, type Invoice } from "../types";

function labelOf<T extends number>(list: ReadonlyArray<{ value: T; label: string }>, value: T): string {
  return list.find((item) => item.value === value)?.label ?? String(value);
}

export function InvoicePrint({ invoice, client }: { invoice: Invoice; client: Client }) {
  const { firmName } = useDesk();
  const seller = sellerPrintLines(client, firmName);
  const banner = printBanner(invoice);
  const brand = client.brandName && client.brandName !== client.businessName ? client.brandName : "";

  return (
    <article className="invoice-print" aria-label="Printable invoice">
      {seller.firmName ? (
        <p className="invoice-print-firm">
          Prepared by <strong>{seller.firmName}</strong>
        </p>
      ) : null}
      <p className={`invoice-print-banner ${banner.tone}`}>{banner.label}</p>
      <header className="invoice-print-head">
        <div className="invoice-print-lockup">
          <p className="kicker">Tax invoice</p>
          <h2>{seller.businessName}</h2>
          {seller.personName ? <p className="invoice-print-person">{seller.personName}</p> : null}
          {brand ? <p className="invoice-print-brand">{brand}</p> : null}
          <p className="invoice-print-place">{seller.place || "Address on the client file"}</p>
        </div>
        <div className="invoice-print-meta mono">
          <div>
            <span>{seller.pntnLabel}</span>
            <b>{seller.pntnValue}</b>
          </div>
          <div>
            <span>{seller.cnicLabel}</span>
            <b>{seller.cnicValue}</b>
          </div>
          <div>
            <span>POS</span>
            <b>{invoice.postedPosId || client.posId || "—"}</b>
          </div>
        </div>
      </header>

      <section className="invoice-print-ids">
        <div>
          <span>USIN</span>
          <b className="mono">{invoice.usin}</b>
        </div>
        <div>
          <span>Fiscal number</span>
          <b className="mono">{invoice.fiscalNumber || "Pending"}</b>
        </div>
        <div>
          <span>Date time</span>
          <b className="mono">{invoice.dateTime}</b>
        </div>
        <div>
          <span>Type / payment</span>
          <b>
            {labelOf(INVOICE_TYPES, invoice.invoiceType)} · {labelOf(PAYMENT_MODES, invoice.paymentMode)}
          </b>
        </div>
        {invoice.saleType ? (
          <div>
            <span>Sale type</span>
            <b>{invoice.saleType}</b>
          </div>
        ) : null}
        {invoice.buyerDistrict ? (
          <div>
            <span>Buyer district</span>
            <b>{invoice.buyerDistrict}</b>
          </div>
        ) : null}
      </section>

      <section className="invoice-print-buyer">
        <h3>Buyer</h3>
        <p>
          <strong>{invoice.buyerName || "Unregistered / walk-in"}</strong>
        </p>
        <p className="mono muted">
          PNTN {invoice.buyerPntn || "—"} · CNIC {invoice.buyerCnic || "—"} · {invoice.buyerPhone || "No phone"}
        </p>
      </section>

      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Description</th>
            <th>Qty</th>
            <th>PCT</th>
            <th>Rate</th>
            <th>Sale</th>
            <th>Discount</th>
            <th>Tax</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((line) => (
            <tr key={line.id}>
              <td className="mono">{line.itemCode}</td>
              <td>{line.itemName}</td>
              <td className="mono">{line.quantity}</td>
              <td className="mono">{line.pctCode}</td>
              <td className="mono">{line.taxRate}%</td>
              <td className="mono">{pkr(line.saleValue)}</td>
              <td className="mono">{pkr(line.discount)}</td>
              <td className="mono">{pkr(line.taxCharged)}</td>
              <td className="mono">{pkr(line.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="invoice-print-totals">
        <div>
          <span>Sale value</span>
          <b>{pkr(invoice.totalSaleValue)}</b>
        </div>
        <div>
          <span>Tax charged</span>
          <b>{pkr(invoice.totalTaxCharged)}</b>
        </div>
        {invoice.furtherTax ? (
          <div>
            <span>Further tax</span>
            <b>{pkr(invoice.furtherTax)}</b>
          </div>
        ) : null}
        {invoice.extraTax ? (
          <div>
            <span>Extra tax</span>
            <b>{pkr(invoice.extraTax)}</b>
          </div>
        ) : null}
        {invoice.stWithheld ? (
          <div>
            <span>ST withheld</span>
            <b>{pkr(invoice.stWithheld)}</b>
          </div>
        ) : null}
        {invoice.discount ? (
          <div>
            <span>Discount</span>
            <b>{pkr(invoice.discount)}</b>
          </div>
        ) : null}
        <div className="invoice-print-bill">
          <span>Bill amount</span>
          <b>{pkr(invoice.totalBillAmount)}</b>
        </div>
      </footer>
      <p className="muted invoice-print-note">
        {(invoice.postedEnvironment ?? client.environment) === "production"
          ? "PRA eIMS production"
          : "PRA eIMS sandbox"}{" "}
        · {client.branchName || "POS"}
      </p>
    </article>
  );
}

export function printInvoice(mode: "a4" | "thermal" = "a4"): void {
  const root = document.documentElement;
  root.classList.toggle("print-thermal", mode === "thermal");
  // Drop the class only when the dialog closes; a timer can fire while it is still open.
  window.addEventListener("afterprint", () => root.classList.remove("print-thermal"), { once: true });
  window.print();
}
