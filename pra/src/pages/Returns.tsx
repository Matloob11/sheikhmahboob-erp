import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Confirm } from "../components/Confirm";
import { AreaField, TextInput } from "../components/Field";
import { NeedClient } from "../components/NeedClient";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { Tabs } from "../components/Tabs";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import { isBlockedCredit, type FileLedger } from "../domain/ledger";
import { sectionPath } from "../domain/nav";
import { markReturn, removePurchase, savePurchase } from "../domain/returns";
import { unlockPeriod } from "../domain/periodLock";
import { formatLongDay, periodLabel } from "../lib/ids";
import { parseAmount, pkr } from "../lib/money";
import type { Purchase, ReturnPeriod } from "../types";

const TABS = [
  { id: "summary", label: "Summary" },
  { id: "annex-a", label: "Annex A" },
  { id: "annex-c", label: "Annex C" },
] as const;

function packReady(status: ReturnPeriod["status"] | undefined): boolean {
  return status === "ready" || status === "filed";
}

function emptyPurchaseForm(period: string) {
  return {
    id: "",
    supplierName: "",
    supplierPntn: "",
    supplierCnic: "",
    invoiceNo: "",
    invoiceDate: `${period}-01`,
    saleValue: "0",
    taxRate: "16",
    pctCode: "",
    district: "",
    withheld: "0",
    notes: "",
    blockedCredit: false,
    reverseCharge: false,
  };
}

function FilingChecklist({
  ledger,
  filing,
  onAnnexA,
  onAnnexC,
  onDownload,
}: {
  ledger: FileLedger;
  filing?: ReturnPeriod;
  onAnnexA: () => void;
  onAnnexC: () => void;
  onDownload: () => void;
}) {
  const salesDone = ledger.saleCount > 0;
  const annexCDone = salesDone;
  const annexADone = ledger.purchases.length > 0;
  const downloadDone = packReady(filing?.status);
  const filed = filing?.status === "filed";
  const current = !salesDone ? 1 : !downloadDone ? 4 : filed ? 0 : 5;

  const steps = [
    {
      n: 1,
      done: salesDone,
      title: (
        <Link to={sectionPath("/invoices")}>Posted sales</Link>
      ),
      note: salesDone ? `${ledger.saleCount} posted this month` : "Post eIMS invoices for the month",
    },
    {
      n: 2,
      done: annexCDone,
      title: (
        <button type="button" className="cell-link" onClick={onAnnexC}>
          Annex C
        </button>
      ),
      note: "Working paper from posted sales — not a portal clone",
    },
    {
      n: 3,
      done: annexADone,
      title: (
        <button type="button" className="cell-link" onClick={onAnnexA}>
          Purchases / Annex A
        </button>
      ),
      note: annexADone
        ? `${ledger.purchases.length} line${ledger.purchases.length === 1 ? "" : "s"}`
        : "Optional if there is no input tax this month",
    },
    {
      n: 4,
      done: downloadDone,
      title: (
        <button type="button" className="cell-link" onClick={onDownload}>
          Download pack
        </button>
      ),
      note: "Excel working paper for this period",
    },
    {
      n: 5,
      done: filed,
      title: (
        <a href="https://e.pra.punjab.gov.pk/public/txplogin.xhtml" target="_blank" rel="noreferrer">
          Upload on IRIS by {formatLongDay(ledger.returnDue)}
        </a>
      ),
      note: "Daftar does not file the return. Mark filed after you upload on IRIS.",
    },
  ];

  return (
    <Panel title="Filing checklist">
      <ol className="checklist">
        {steps.map((step) => (
          <li
            key={step.n}
            className={step.done ? "done" : current === step.n ? "current" : undefined}
          >
            <span className="step" aria-hidden>
              {step.done ? "✓" : step.n}
            </span>
            <div>
              <strong>{step.title}</strong>
              <div className="muted">{step.note}</div>
            </div>
            <Badge tone={step.done ? "posted" : current === step.n ? "ready" : "open"}>
              {step.done ? "done" : current === step.n ? "next" : "open"}
            </Badge>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function ReturnsPage() {
  const { client, period, ledger, filing } = useDesk();
  const { push } = useNotice();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("summary");
  const [errors, setErrors] = useState<string[]>([]);
  const [irisAck, setIrisAck] = useState(filing?.irisAck ?? "");
  const [purchase, setPurchase] = useState(emptyPurchaseForm(period));
  const [addingPurchase, setAddingPurchase] = useState(false);
  const [pendingPurchase, setPendingPurchase] = useState<string | null>(null);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const purchaseDate = purchase.invoiceDate.startsWith(period) ? purchase.invoiceDate : `${period}-01`;
  const annexC = ledger
    ? ledger.sales.flatMap((invoice) => {
        const lines = invoice.items.length
          ? invoice.items
          : [
              {
                id: invoice.id,
                pctCode: "",
                taxRate: 0,
                saleValue: invoice.totalSaleValue,
                taxCharged: invoice.totalTaxCharged,
              },
            ];
        return lines.map((line, index) => ({
          key: `${invoice.id}-${line.id}-${index}`,
          invoice,
          pctCode: line.pctCode,
          taxRate: line.taxRate,
          saleValue: line.saleValue,
          taxCharged: line.taxCharged,
        }));
      })
    : [];

  async function downloadPack() {
    if (!client || !ledger) return;
    await import("../lib/excel").then((mod) =>
      mod.exportReturnPack({
        client,
        period,
        sales: ledger.sales,
        purchases: ledger.purchases,
        psids: ledger.psids,
      }),
    );
    push("info", "Return workbook downloaded. Upload annexures on PRA IRIS.");
  }

  function loadPurchase(row: Purchase) {
    setPurchase({
      id: row.id,
      supplierName: row.supplierName,
      supplierPntn: row.supplierPntn,
      supplierCnic: row.supplierCnic ?? "",
      invoiceNo: row.invoiceNo,
      invoiceDate: row.invoiceDate,
      saleValue: String(row.saleValue),
      taxRate: String(row.taxRate),
      pctCode: row.pctCode ?? "",
      district: row.district ?? "",
      withheld: String(row.withheld ?? 0),
      notes: row.notes,
      blockedCredit: row.blockedCredit === true,
      reverseCharge: row.reverseCharge === true,
    });
    setTab("annex-a");
  }

  async function onSavePurchase() {
    if (!client) return;
    const result = await savePurchase({
      id: purchase.id || undefined,
      clientId: client.id,
      period,
      supplierName: purchase.supplierName,
      supplierPntn: purchase.supplierPntn,
      supplierCnic: purchase.supplierCnic,
      invoiceNo: purchase.invoiceNo,
      invoiceDate: purchaseDate,
      saleValue: parseAmount(purchase.saleValue),
      taxRate: parseAmount(purchase.taxRate),
      pctCode: purchase.pctCode,
      district: purchase.district,
      withheld: parseAmount(purchase.withheld),
      notes: purchase.notes,
      blockedCredit: purchase.blockedCredit,
      reverseCharge: purchase.reverseCharge,
    });
    setErrors(result.errors);
    if (result.errors.length) {
      push("bad", result.errors[0] ?? "Purchase not saved.");
      return;
    }
    setPurchase(emptyPurchaseForm(period));
    setAddingPurchase(false);
    push("good", purchase.id ? "Annex A line updated." : "Annex A line saved.");
  }

  async function importPurchases(file: File) {
    if (!client) return;
    try {
      const { parsePurchasesWorkbook } = await import("../lib/excel");
      const rows = await parsePurchasesWorkbook(file);
      if (!rows.length) {
        push("info", "No purchase rows found in that workbook.");
        return;
      }
      let saved = 0;
      const rowErrors: string[] = [];
      for (const row of rows) {
        const result = await savePurchase({
          clientId: client.id,
          period,
          supplierName: row.supplierName,
          supplierPntn: row.supplierPntn,
          supplierCnic: row.supplierCnic,
          invoiceNo: row.invoiceNo,
          invoiceDate: row.invoiceDate || `${period}-01`,
          saleValue: row.saleValue,
          taxRate: row.taxRate,
          pctCode: row.pctCode,
          district: row.district,
          withheld: row.withheld,
          notes: row.notes,
          reverseCharge: row.reverseCharge,
        });
        if (result.errors.length) {
          rowErrors.push(`${row.invoiceNo || row.supplierName}: ${result.errors[0]}`);
        } else {
          saved += 1;
        }
      }
      setErrors(rowErrors);
      push(
        rowErrors.length ? "bad" : "good",
        `Imported ${saved} purchase${saved === 1 ? "" : "s"}${rowErrors.length ? `, ${rowErrors.length} with errors` : ""}.`,
      );
    } catch (error) {
      push("bad", error instanceof Error ? error.message : "Purchase import failed.");
    }
  }

  if (!client || !ledger) {
    return (
      <NeedClient title="Select a client" body="Return packs are built per taxpayer and working month." />
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Returns"
        actions={<Badge tone={filing?.status ?? "open"}>{filing?.status ?? "open"}</Badge>}
      />

      <FilingChecklist
        ledger={ledger}
        filing={filing}
        onAnnexA={() => setTab("annex-a")}
        onAnnexC={() => setTab("annex-c")}
        onDownload={() => void downloadPack()}
      />

      <Tabs tabs={[...TABS]} value={tab} onChange={(id) => setTab(id as (typeof TABS)[number]["id"])} />

      {tab === "summary" ? (
        <Panel title={`${periodLabel(period)} · ${client.businessName}`}>
          <div className="kpi-row">
            <article className="kpi">
              <span>Posted sales</span>
              <b>{ledger.saleCount}</b>
            </article>
            <article className="kpi">
              <span>Output tax</span>
              <b>{pkr(ledger.outputTax)}</b>
            </article>
            <article className="kpi">
              <span>Input tax (adjustable)</span>
              <b>{pkr(ledger.inputTax)}</b>
            </article>
            <article className="kpi">
              <span>Blocked credit</span>
              <b>{pkr(ledger.blockedInputTax)}</b>
            </article>
            <article className="kpi">
              <span>Net estimate</span>
              <b>{pkr(ledger.netPayable)}</b>
            </article>
          </div>
          {filing?.filedAt ? (
            <p className="muted">
              Marked filed {formatLongDay(new Date(filing.filedAt))}
              {filing.irisAck ? ` · IRIS ack ${filing.irisAck}` : ""}
            </p>
          ) : null}
          <TextInput
            label="IRIS acknowledgement (optional)"
            value={irisAck}
            onChange={(event) => setIrisAck(event.target.value)}
            hint="Paste after you upload on IRIS. Daftar does not file the return."
          />
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn stamp" type="button" onClick={() => void downloadPack()}>
              Export return workbook
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                void markReturn({
                  clientId: client.id,
                  period,
                  status: "ready",
                  existing: filing,
                  irisAck,
                }).then(() => push("good", `${periodLabel(period)} marked ready.`));
              }}
            >
              Mark ready
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                void markReturn({
                  clientId: client.id,
                  period,
                  status: "filed",
                  existing: filing,
                  irisAck,
                }).then(() => push("good", `${periodLabel(period)} marked filed on IRIS.`));
              }}
            >
              Mark filed on IRIS
            </button>
            {filing?.status === "filed" ? (
              <button className="btn" type="button" onClick={() => setConfirmUnlock(true)}>
                Unlock period
              </button>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {tab === "annex-a" ? (
        <Panel title="Annex A — purchases">
          <div className="stack">
            {errors.length ? (
              <div className="alert bad">
                {errors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            ) : null}
            <div className="row">
              <button
                className="btn stamp"
                type="button"
                onClick={() => {
                  setPurchase(emptyPurchaseForm(period));
                  setAddingPurchase(true);
                }}
              >
                Add purchase
              </button>
              <label className="btn ghost">
                Import Annex A Excel
                <input
                  type="file"
                  accept=".xlsx"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importPurchases(file);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            {addingPurchase || purchase.id ? (
            <>
            <div className="form-grid">
              <TextInput
                label="Supplier"
                value={purchase.supplierName}
                onChange={(event) => setPurchase({ ...purchase, supplierName: event.target.value })}
              />
              <TextInput
                label="Supplier PNTN"
                className="mono"
                value={purchase.supplierPntn}
                onChange={(event) => setPurchase({ ...purchase, supplierPntn: event.target.value })}
              />
              <TextInput
                label="Supplier CNIC"
                className="mono"
                value={purchase.supplierCnic}
                onChange={(event) => setPurchase({ ...purchase, supplierCnic: event.target.value })}
              />
              <TextInput
                label="Invoice no"
                value={purchase.invoiceNo}
                onChange={(event) => setPurchase({ ...purchase, invoiceNo: event.target.value })}
              />
              <TextInput
                label="Date"
                type="date"
                value={purchaseDate}
                onChange={(event) => setPurchase({ ...purchase, invoiceDate: event.target.value })}
              />
              <TextInput
                label="HS / PCT"
                className="mono"
                value={purchase.pctCode}
                onChange={(event) => setPurchase({ ...purchase, pctCode: event.target.value })}
              />
              <TextInput
                label="Sale value"
                value={purchase.saleValue}
                onChange={(event) => setPurchase({ ...purchase, saleValue: event.target.value })}
              />
              <TextInput
                label="Tax rate"
                value={purchase.taxRate}
                onChange={(event) => setPurchase({ ...purchase, taxRate: event.target.value })}
              />
              <TextInput
                label="District"
                value={purchase.district}
                onChange={(event) => setPurchase({ ...purchase, district: event.target.value })}
              />
              <TextInput
                label="ST withheld"
                value={purchase.withheld}
                onChange={(event) => setPurchase({ ...purchase, withheld: event.target.value })}
              />
              <AreaField
                label="Notes"
                value={purchase.notes}
                onChange={(event) => setPurchase({ ...purchase, notes: event.target.value })}
              />
            </div>
            <label className="row">
              <input
                type="checkbox"
                checked={purchase.blockedCredit}
                onChange={(event) => setPurchase({ ...purchase, blockedCredit: event.target.checked })}
              />
              Non-adjustable / blocked input tax
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={purchase.reverseCharge}
                onChange={(event) => setPurchase({ ...purchase, reverseCharge: event.target.checked })}
              />
              Reverse charge
            </label>
            <div className="row">
              <button className="btn ghost" type="button" onClick={() => void onSavePurchase()}>
                {purchase.id ? "Update purchase" : "Add purchase"}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  setPurchase(emptyPurchaseForm(period));
                  setAddingPurchase(false);
                }}
              >
                Cancel
              </button>
            </div>
            </>
            ) : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Document</th>
                    <th>HS / PCT</th>
                    <th>Value excl. ST</th>
                    <th>Sales tax</th>
                    <th>Credit</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ledger.purchases.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.supplierName}
                        <div className="mono muted">{row.supplierPntn || row.supplierCnic || "—"}</div>
                      </td>
                      <td>
                        <div className="mono">{row.invoiceNo}</div>
                        <div className="muted">{row.invoiceDate} · PI</div>
                      </td>
                      <td className="mono">{row.pctCode || "—"}</td>
                      <td>{pkr(row.saleValue)}</td>
                      <td>{pkr(row.taxCharged)}</td>
                      <td>
                        {isBlockedCredit(row) ? (
                          <Badge tone="failed">blocked</Badge>
                        ) : (
                          <Badge tone="posted">adjustable</Badge>
                        )}
                      </td>
                      <td>
                        <button className="btn ghost" type="button" onClick={() => { loadPurchase(row); setAddingPurchase(true); }}>
                          Edit
                        </button>
                        <button className="btn ghost" type="button" onClick={() => setPendingPurchase(row.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {ledger.purchases.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted">
                        No Annex A lines for this month.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      ) : null}

      {tab === "annex-c" ? (
        <Panel title="Annex C — posted sales">
          <div className="stack">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Buyer</th>
                    <th>Document</th>
                    <th>HS / rate</th>
                    <th>Value excl. ST</th>
                    <th>Sales tax</th>
                    <th>Extras</th>
                  </tr>
                </thead>
                <tbody>
                  {annexC.map((row) => (
                      <tr key={row.key}>
                        <td>
                          {row.invoice.buyerName || "—"}
                          <div className="mono muted">
                            {row.invoice.buyerPntn || row.invoice.buyerCnic || "End consumer"}
                          </div>
                          {row.invoice.buyerDistrict ? (
                            <div className="muted">{row.invoice.buyerDistrict}</div>
                          ) : null}
                        </td>
                        <td>
                          <Link className="mono cell-link" to={sectionPath(`/invoices/${row.invoice.id}`)}>
                            {row.invoice.usin}
                          </Link>
                          <div className="muted">
                            {row.invoice.invoiceType === 2 ? "DN" : row.invoice.invoiceType === 3 ? "CN" : "SI"} ·{" "}
                            {row.invoice.dateTime.slice(0, 10)}
                          </div>
                        </td>
                        <td className="mono">
                          {row.pctCode || "—"}
                          {row.taxRate ? ` · ${row.taxRate}%` : ""}
                        </td>
                        <td>{pkr(row.saleValue)}</td>
                        <td>{pkr(row.taxCharged)}</td>
                        <td className="muted">
                          ST withheld {pkr(row.invoice.stWithheld ?? 0)}
                          <div>Reverse {row.invoice.reverseCharge ? "Yes" : "No"}</div>
                        </td>
                      </tr>
                  ))}
                  {annexC.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        Post eIMS invoices in this month to fill Annex C.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <AreaField
              label="Filing notes"
              value={filing?.notes ?? ""}
              onChange={(event) => {
                void markReturn({
                  clientId: client.id,
                  period,
                  status: filing?.status ?? "open",
                  existing: filing,
                  notes: event.target.value,
                  irisAck,
                });
              }}
            />
          </div>
        </Panel>
      ) : null}
      <Confirm
        open={confirmUnlock}
        danger
        title="Unlock this period?"
        body="Invoices and purchases can change again. Confirm only if you meant to reopen the return."
        confirmLabel="Unlock"
        onCancel={() => setConfirmUnlock(false)}
        onConfirm={() => {
          setConfirmUnlock(false);
          void unlockPeriod(client.id, period)
            .then(() => push("good", `${periodLabel(period)} unlocked.`))
            .catch((error: unknown) =>
              push("bad", error instanceof Error ? error.message : "Could not unlock."),
            );
        }}
      />
      <Confirm
        open={Boolean(pendingPurchase)}
        danger
        title="Remove this Annex A line?"
        body="The working paper updates. Official IRIS annexes stay on the portal."
        confirmLabel="Remove line"
        onCancel={() => setPendingPurchase(null)}
        onConfirm={() => {
          if (!pendingPurchase) return;
          void removePurchase(pendingPurchase).then(() => {
            if (purchase.id === pendingPurchase) {
              setPurchase(emptyPurchaseForm(period));
              setAddingPurchase(false);
            }
            setPendingPurchase(null);
            push("info", "Purchase line removed.");
          });
        }}
      />
    </div>
  );
}
