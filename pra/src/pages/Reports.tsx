import { useState } from "react";
import { NeedClient } from "../components/NeedClient";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { Tabs } from "../components/Tabs";
import { useDesk } from "../context/DeskContext";
import {
  buyerLedger,
  failedPosts,
  psidGapRows,
  salesBook,
  taxByPct,
} from "../domain/reports";
import { periodLabel } from "../lib/ids";
import { pkr } from "../lib/money";
import { exportReportCsv, exportReportWorkbook } from "../lib/reportExport";
import { INVOICE_TYPES } from "../types";

function typeLabel(value: number): string {
  return INVOICE_TYPES.find((row) => row.value === value)?.label ?? String(value);
}

export function ReportsPage() {
  const { client, period, invoices, ledger } = useDesk();
  const [tab, setTab] = useState("sales");

  if (!client || !ledger) {
    return (
      <NeedClient
        title="Select a client"
        body="Reports attach to one taxpayer file and the working month."
      />
    );
  }

  const book = salesBook(invoices, client.id, period);
  const pct = taxByPct(invoices, client.id, period);
  const buyers = buyerLedger(invoices, client.id, period);
  const failed = failedPosts(invoices, client.id, period);
  const gap = psidGapRows(ledger);
  const stamp = `${client.businessName.replace(/\s+/g, "-").toLowerCase()}-${period}`;

  function exportExcel() {
    void exportReportWorkbook(`daftar-reports-${stamp}.xlsx`, [
      {
        name: "Sales book",
        headers: ["USIN", "Date", "Buyer", "Type", "Status", "Sale", "Tax", "Bill", "Fiscal", "Last code"],
        rows: book.map((row) => [
          row.usin,
          row.dateTime,
          row.buyer,
          typeLabel(row.type),
          row.status,
          row.sale,
          row.tax,
          row.bill,
          row.fiscal,
          row.lastCode,
        ]),
      },
      {
        name: "Tax by PCT",
        headers: ["PCT", "Qty", "Sale", "Tax", "Further tax"],
        rows: pct.map((row) => [row.pctCode, row.quantity, row.sale, row.tax, row.furtherTax]),
      },
      {
        name: "Buyer ledger",
        headers: ["Buyer", "Count", "Sale", "Tax"],
        rows: buyers.map((row) => [row.buyer, row.count, row.sale, row.tax]),
      },
      {
        name: "PSID gap",
        headers: ["PSID", "Head", "Status", "Amount", "Due"],
        rows: gap.unpaid.map((row) => [row.psid || "—", row.head, row.status, row.amount, row.dueOn || ""]),
      },
      {
        name: "Failed posts",
        headers: ["USIN", "Date", "Code", "Message"],
        rows: failed.map((row) => [row.usin, row.dateTime, row.lastCode, row.lastError]),
      },
    ]);
  }

  return (
    <div className="stack">
      <PageHeader
        kicker={periodLabel(period)}
        title="Reports"
        actions={
          <button className="btn stamp" type="button" onClick={exportExcel}>
            Export Excel
          </button>
        }
      />

      <Tabs
        tabs={[
          { id: "sales", label: "Sales book" },
          { id: "pct", label: "Tax by PCT" },
          { id: "buyers", label: "Buyer ledger" },
          { id: "psid", label: "PSID gap" },
          { id: "failed", label: "Failed posts" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "sales" ? (
      <Panel
        title="Sales book"
        actions={
          <button
            className="btn ghost"
            type="button"
            onClick={() =>
              exportReportCsv(
                `daftar-sales-${stamp}.csv`,
                ["USIN", "Date", "Buyer", "Type", "Status", "Sale", "Tax", "Bill", "Fiscal", "Last code"],
                book.map((row) => [
                  row.usin,
                  row.dateTime,
                  row.buyer,
                  typeLabel(row.type),
                  row.status,
                  row.sale,
                  row.tax,
                  row.bill,
                  row.fiscal,
                  row.lastCode,
                ]),
              )
            }
          >
            CSV
          </button>
        }
      >
        {book.length === 0 ? (
          <p className="muted">No invoices in {periodLabel(period)}.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>USIN</th>
                  <th>Date</th>
                  <th>Buyer</th>
                  <th>Status</th>
                  <th>Bill</th>
                  <th>Fiscal</th>
                </tr>
              </thead>
              <tbody>
                {book.map((row) => (
                  <tr key={row.usin}>
                    <td className="mono">{row.usin}</td>
                    <td className="mono">{row.dateTime}</td>
                    <td>{row.buyer}</td>
                    <td>{row.status}</td>
                    <td>{pkr(row.bill)}</td>
                    <td className="mono">{row.fiscal || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      ) : null}

      {tab === "pct" ? (
      <Panel
        title="Tax by PCT"
        actions={
          <button
            className="btn ghost"
            type="button"
            onClick={() =>
              exportReportCsv(
                `daftar-pct-${stamp}.csv`,
                ["PCT", "Qty", "Sale", "Tax", "Further tax"],
                pct.map((row) => [row.pctCode, row.quantity, row.sale, row.tax, row.furtherTax]),
              )
            }
          >
            CSV
          </button>
        }
      >
        {pct.length === 0 ? (
          <p className="muted">No posted lines in this period.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PCT</th>
                  <th>Qty</th>
                  <th>Sale</th>
                  <th>Tax</th>
                  <th>Further</th>
                </tr>
              </thead>
              <tbody>
                {pct.map((row) => (
                  <tr key={row.pctCode}>
                    <td className="mono">{row.pctCode}</td>
                    <td className="mono">{row.quantity}</td>
                    <td>{pkr(row.sale)}</td>
                    <td>{pkr(row.tax)}</td>
                    <td>{pkr(row.furtherTax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      ) : null}

      {tab === "buyers" ? (
      <Panel
        title="Buyer ledger"
        actions={
          <button
            className="btn ghost"
            type="button"
            onClick={() =>
              exportReportCsv(
                `daftar-buyers-${stamp}.csv`,
                ["Buyer", "Count", "Sale", "Tax"],
                buyers.map((row) => [row.buyer, row.count, row.sale, row.tax]),
              )
            }
          >
            CSV
          </button>
        }
      >
        {buyers.length === 0 ? (
          <p className="muted">No posted buyers in this period.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Count</th>
                  <th>Sale</th>
                  <th>Tax</th>
                </tr>
              </thead>
              <tbody>
                {buyers.map((row) => (
                  <tr key={row.key}>
                    <td>{row.buyer}</td>
                    <td className="mono">{row.count}</td>
                    <td>{pkr(row.sale)}</td>
                    <td>{pkr(row.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      ) : null}

      {tab === "psid" ? (
      <Panel title="Unpaid / PSID gap">
        <p className="muted">
          Paid {pkr(gap.paid)} · gap {pkr(gap.gap)}
        </p>
        {gap.unpaid.length === 0 ? (
          <p className="muted">No unpaid PSID rows this month.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PSID</th>
                  <th>Head</th>
                  <th>Status</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {gap.unpaid.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.psid || "—"}</td>
                    <td>{row.head}</td>
                    <td>{row.status}</td>
                    <td>{pkr(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      ) : null}

      {tab === "failed" ? (
      <Panel
        title="Failed posts"
        actions={
          <button
            className="btn ghost"
            type="button"
            onClick={() =>
              exportReportCsv(
                `daftar-failed-${stamp}.csv`,
                ["USIN", "Date", "Code", "Message"],
                failed.map((row) => [row.usin, row.dateTime, row.lastCode, row.lastError]),
              )
            }
          >
            CSV
          </button>
        }
      >
        {failed.length === 0 ? (
          <p className="muted">No failed posts in {periodLabel(period)}.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>USIN</th>
                  <th>Date</th>
                  <th>Code</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {failed.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.usin}</td>
                    <td className="mono">{row.dateTime}</td>
                    <td className="mono">{row.lastCode || "—"}</td>
                    <td>{row.lastError || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      ) : null}
    </div>
  );
}
