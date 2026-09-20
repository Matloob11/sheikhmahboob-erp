import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Confirm } from "../components/Confirm";
import { EmptyState } from "../components/EmptyState";
import { NeedClient } from "../components/NeedClient";
import { PageHeader } from "../components/PageHeader";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import {
  posChecks,
  previewSalesImport,
  commitSalesImport,
  submitInvoice,
  validateInvoiceBatch,
  type SalesImportPreviewRow,
} from "../domain/invoices";
import {
  hasExtraInvoiceFilters,
  shouldShowInvoiceBulkBar,
  shouldShowInvoiceExtraFilters,
} from "../domain/deskChrome";
import {
  distinctInvoiceBuyers,
  filterInvoiceList,
  parseInvoiceListSearch,
  writeInvoiceListSearch,
  type InvoiceListQuery,
} from "../domain/invoiceList";
import { sectionPath } from "../domain/nav";
import { periodLabel } from "../lib/ids";
import { pkr } from "../lib/money";
import type { Invoice, InvoiceStatus } from "../types";

const STATUS_PILLS: ReadonlyArray<{ value: InvoiceStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "validated", label: "Validated" },
  { value: "posted", label: "Posted" },
  { value: "failed", label: "Failed" },
  { value: "unknown", label: "Unclear" },
];

type BulkStored = { id: string; ok: boolean; message: string; at: number };

function bulkKey(clientId: string): string {
  return `daftar.bulkResults.${clientId}`;
}

function readBulkResults(clientId: string): Record<string, { ok: boolean; message: string }> {
  try {
    const raw = sessionStorage.getItem(bulkKey(clientId));
    if (!raw) return {};
    const rows = JSON.parse(raw) as BulkStored[];
    return Object.fromEntries(rows.map((row) => [row.id, { ok: row.ok, message: row.message }]));
  } catch {
    return {};
  }
}

function writeBulkResults(
  clientId: string,
  results: Record<string, { ok: boolean; message: string }>,
): void {
  const rows: BulkStored[] = Object.entries(results).map(([id, row]) => ({
    id,
    ok: row.ok,
    message: row.message,
    at: Date.now(),
  }));
  sessionStorage.setItem(bulkKey(clientId), JSON.stringify(rows));
}

export function InvoicesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { client, invoices, period } = useDesk();
  const { push } = useNotice();
  const listQuery = useMemo(() => parseInvoiceListSearch(params.toString()), [params]);
  const { status, scope, query, from, to, buyer } = listQuery;
  const patchListQuery = useCallback(
    (partial: Partial<InvoiceListQuery>) => {
      const next = writeInvoiceListSearch({ ...listQuery, ...partial });
      setParams(next, { replace: true });
    },
    [listQuery, setParams],
  );
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [busy, setBusy] = useState<"validate" | "post" | "import" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmBulkPost, setConfirmBulkPost] = useState(false);
  const [importPreview, setImportPreview] = useState<SalesImportPreviewRow[] | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!client) return;
    setResults(readBulkResults(client.id));
  }, [client?.id]);

  const checks = client ? posChecks(client) : [];

  const fileRows = useMemo(
    () => invoices.filter((invoice) => !client || invoice.clientId === client.id),
    [invoices, client],
  );
  const buyerOptions = useMemo(() => distinctInvoiceBuyers(fileRows), [fileRows]);
  const rows = useMemo(
    () =>
      filterInvoiceList(invoices, {
        clientId: client?.id,
        status,
        scope,
        period,
        query,
        from,
        to,
        buyer,
      }),
    [invoices, client?.id, status, scope, period, query, from, to, buyer],
  );
  const statusCounts = useMemo(() => {
    const listed = filterInvoiceList(invoices, {
      clientId: client?.id,
      status: "all",
      scope,
      period,
      query,
      from,
      to,
      buyer,
    });
    const counts: Record<string, number> = { all: listed.length };
    for (const invoice of listed) counts[invoice.status] = (counts[invoice.status] ?? 0) + 1;
    return counts;
  }, [invoices, client?.id, scope, period, query, from, to, buyer]);
  const extraFilter = hasExtraInvoiceFilters({ query, from, to, buyer });
  const showExtraFilters = shouldShowInvoiceExtraFilters(filtersOpen, extraFilter);

  const sorted = useMemo(
    () => rows.slice().sort((a, b) => b.createdAt - a.createdAt),
    [rows],
  );

  const chosen = sorted.filter((invoice) => selected[invoice.id]);
  const showBulk = shouldShowInvoiceBulkBar(sorted.length, chosen.length);
  const targets = chosen.length ? chosen : sorted;
  const draftsWaiting = targets.filter(
    (invoice) => invoice.status !== "validated" && invoice.status !== "posted" && !invoice.inFlight,
  );
  const postable = targets.filter((invoice) => invoice.status === "validated" && !invoice.inFlight);

  function persistResults(next: Record<string, { ok: boolean; message: string }>) {
    setResults(next);
    if (client) writeBulkResults(client.id, next);
  }

  function toggle(id: string, on: boolean) {
    setSelected((current) => ({ ...current, [id]: on }));
  }

  async function importFile(file: File) {
    if (!client) return;
    setBusy("import");
    try {
      const preview = await previewSalesImport(client, file);
      if (!preview.rows.length) {
        push("info", "No sales rows found in that workbook.");
        return;
      }
      setImportPreview(preview.rows);
    } catch (error) {
      push("bad", error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }

  async function commitImport() {
    if (!client || !importPreview) return;
    const drafts = importPreview
      .filter((row) => row.draft && row.errors.length === 0)
      .map((row) => row.draft as NonNullable<SalesImportPreviewRow["draft"]>);
    if (!drafts.length) {
      push("info", "No error-free rows to import.");
      setImportPreview(null);
      return;
    }
    setBusy("import");
    try {
      const { saved, skipped } = await commitSalesImport(client, drafts);
      push(
        saved ? "good" : "info",
        `Imported ${saved} draft${saved === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}. Validate listed before posting.`,
      );
    } catch (error) {
      push("bad", error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(null);
      setImportPreview(null);
    }
  }

  async function runBulkValidate() {
    if (!client) return;
    if (!targets.length) {
      push("info", "No invoices in this list.");
      return;
    }
    setBusy("validate");
    try {
      const rowsResult = await validateInvoiceBatch(client, targets);
      persistResults(
        Object.fromEntries(rowsResult.map((row) => [row.id, { ok: row.ok, message: row.message }])),
      );
      const failed = rowsResult.filter((row) => !row.ok && !row.skipped).length;
      push(failed ? "bad" : "good", failed ? `${failed} invoice${failed === 1 ? "" : "s"} failed local checks.` : "Listed invoices passed local checks.");
    } catch (error) {
      push("bad", error instanceof Error ? error.message : "Bulk validate failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runBulkPost() {
    if (!client) return;
    if (!postable.length) {
      push("info", draftsWaiting.length ? "Validate listed first." : "Nothing to post. Only validated invoices are sent from this list.");
      setConfirmBulkPost(false);
      return;
    }
    cancelRef.current = false;
    setBusy("post");
    setProgress({ done: 0, total: postable.length });
    const next = { ...results };
    try {
      for (let index = 0; index < postable.length; index += 1) {
        if (cancelRef.current) break;
        const invoice = postable[index];
        if (!invoice) continue;
        const outcome = await submitInvoice(client, invoice);
        next[invoice.id] = {
          ok: outcome.alreadyPosted || (outcome.errors.length === 0 && outcome.invoice.status === "posted"),
          message:
            outcome.errors[0] ??
            (outcome.invoice.status === "posted" ? "Posted." : "PRA rejected the invoice."),
        };
        persistResults({ ...next });
        setProgress({ done: index + 1, total: postable.length });
      }
      const posted = Object.values(next).filter((row) => row.ok).length;
      if (cancelRef.current) push("info", "Stopped. The invoice that was being sent will finish on its own.");
      else if (posted) push("good", "Bulk post finished. See per-row results.");
      else push("info", "No new posts. See per-row results.");
    } catch (error) {
      push("bad", error instanceof Error ? error.message : "Bulk post failed.");
    } finally {
      setBusy(null);
      setProgress(null);
      setConfirmBulkPost(false);
    }
  }

  function requestBulkPost() {
    if (!client) return;
    if (!postable.length) {
      push("info", draftsWaiting.length ? "Validate listed first." : "Nothing to post. Only validated invoices are sent from this list.");
      return;
    }
    if (client.environment === "production" || postable.length > 1) {
      setConfirmBulkPost(true);
      return;
    }
    void runBulkPost();
  }

  if (!client) {
    return (
      <NeedClient
        title="Select a client"
        body="eIMS posts belong to one taxpayer at a time."
      />
    );
  }

  const goodImport = importPreview?.filter((row) => row.errors.length === 0).length ?? 0;

  return (
    <div className="stack">
      <PageHeader
        title="Invoices"
        actions={
          <>
            <select value={scope} onChange={(event) => patchListQuery({ scope: event.target.value as "period" | "all" })}>
              <option value="period">{periodLabel(period)}</option>
              <option value="all">All months</option>
            </select>
            <button
              className="btn ghost"
              type="button"
              aria-expanded={showExtraFilters}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {showExtraFilters ? "Hide filters" : extraFilter ? "Filters on" : "Filters"}
            </button>
            <button className="btn ghost" type="button" onClick={() => void import("../lib/excel").then((mod) => mod.exportSalesTemplate())}>
              Template
            </button>
            <label className="btn ghost">
              Import
              <input
                type="file"
                accept=".xlsx"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importFile(file);
                  event.target.value = "";
                }}
              />
            </label>
            <Link className="btn stamp" to={sectionPath("/invoices/new")}>
              New invoice
            </Link>
          </>
        }
      />

      {checks.filter((check) => check.tone === "bad").map((check) => (
        <div key={check.title} className={`alert ${check.tone}`}>
          <strong>{check.title}.</strong> {check.body}{" "}
          {check.tone === "info" ? (
            <a href="mailto:eims@pra.punjab.gov.pk">eims@pra.punjab.gov.pk</a>
          ) : null}
        </div>
      ))}

      {showExtraFilters ? (
      <div className="row invoice-filters" role="search" aria-label="Find invoices">
        <label className="field">
          <span>Search</span>
          <input
            type="search"
            value={query}
            placeholder="USIN, fiscal, buyer…"
            aria-label="Search USIN, fiscal or buyer"
            onChange={(event) => patchListQuery({ query: event.target.value })}
          />
        </label>
        <label className="field">
          <span>From</span>
          <input type="date" lang="en-GB" value={from} aria-label="From date" onChange={(event) => patchListQuery({ from: event.target.value })} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" lang="en-GB" value={to} aria-label="To date" onChange={(event) => patchListQuery({ to: event.target.value })} />
        </label>
        <label className="field">
          <span>Buyer</span>
          <select value={buyer} aria-label="Buyer" onChange={(event) => patchListQuery({ buyer: event.target.value })}>
            <option value="">All buyers</option>
            {buyerOptions.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      ) : null}

      <div className="status-pills" role="group" aria-label="Filter by status">
        {STATUS_PILLS.map((pill) => (
          <button
            key={pill.value}
            type="button"
            className={status === pill.value ? "status-pill on" : "status-pill"}
            aria-pressed={status === pill.value}
            onClick={() => patchListQuery({ status: pill.value })}
          >
            {pill.label}
            <span>{statusCounts[pill.value] ?? 0}</span>
          </button>
        ))}
      </div>

      {showBulk ? (
      <div className="row" role="toolbar" aria-label="Invoice list">
        <button className="btn ghost" type="button" disabled={Boolean(busy) || !targets.length} onClick={() => void runBulkValidate()}>
          {busy === "validate" ? "Validating…" : "Validate listed"}
        </button>
        <button className="btn ghost" type="button" disabled={Boolean(busy) || !postable.length} onClick={requestBulkPost}>
          {busy === "post" ? "Posting…" : "Post listed"}
        </button>
        {busy === "post" ? (
          <button className="btn ghost" type="button" onClick={() => { cancelRef.current = true; }}>
            Cancel posting
          </button>
        ) : null}
        <span className="muted" aria-live="polite">
          {progress
            ? `${progress.done} / ${progress.total}`
            : chosen.length
              ? `${chosen.length} selected · ${postable.length} validated to post`
              : `${sorted.length} listed`}
          {draftsWaiting.length && !progress ? " · Validate listed first" : ""}
        </span>
      </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title={
            extraFilter
              ? "No invoices match these filters"
              : status === "all" && scope === "all"
                ? "No invoices on this file yet"
                : status !== "all"
                  ? `No ${status} invoices${scope === "period" ? ` in ${periodLabel(period)}` : ""}`
                  : `No invoices in ${periodLabel(period)}`
          }
          body={
            extraFilter
              ? "Clear the search, dates, or buyer, or switch to all months."
              : status === "all" && scope === "all"
                ? "Write one by hand, or import the sales Excel. Posts stay drafts until you send them to PRA."
                : status !== "all"
                  ? "Nothing matches this status. Try all statuses, or write a new invoice."
                  : "New invoices use the working month. Switch to all months, or write one."
          }
          action={
            <div className="row">
              <Link className="btn stamp" to={sectionPath("/invoices/new")}>
                New invoice
              </Link>
              <button
                className="btn ghost"
                type="button"
                onClick={() => void import("../lib/excel").then((mod) => mod.exportSalesTemplate())}
              >
                Download template
              </button>
            </div>
          }
        />
      ) : (
        <div className="table-wrap invoice-table">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all listed invoices"
                    checked={sorted.length > 0 && sorted.every((invoice) => selected[invoice.id])}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setSelected(Object.fromEntries(sorted.map((invoice) => [invoice.id, on])));
                    }}
                  />
                </th>
                <th>USIN</th>
                <th>Buyer</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Fiscal no</th>
                <th>Status</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((invoice) => (
                <InvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  checked={Boolean(selected[invoice.id])}
                  result={results[invoice.id]}
                  onToggle={(on) => toggle(invoice.id, on)}
                  onOpen={() => navigate(sectionPath(`/invoices/${invoice.id}`))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Confirm
        open={confirmBulkPost}
        danger={client.environment === "production"}
        title={`Post ${postable.length} validated invoice${postable.length === 1 ? "" : "s"} for ${client.businessName}?`}
        body={
          client.environment === "production"
            ? "This sends each validated invoice to PRA production. Invoices already sent, or being sent right now, are skipped."
            : "This sends each validated invoice to the PRA sandbox. Invoices already sent, or being sent right now, are skipped."
        }
        confirmLabel={client.environment === "production" ? "Post to production" : "Post to sandbox"}
        onCancel={() => setConfirmBulkPost(false)}
        onConfirm={() => void runBulkPost()}
      />

      <Confirm
        open={importPreview !== null}
        title="Import preview"
        body={
          importPreview ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>USIN</th>
                    <th>Date</th>
                    <th>Buyer</th>
                    <th>Lines</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.map((row) => (
                    <tr key={row.usin}>
                      <td className="mono">{row.usin}</td>
                      <td className="mono">{row.dateTime || "—"}</td>
                      <td>{row.buyerName || "—"}</td>
                      <td>{row.lineCount}</td>
                      <td className={row.errors.length ? "tone-late" : "tone-ok"}>
                        {row.errors.length ? row.errors.join(" ") : "Ready"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null
        }
        confirmLabel={goodImport ? `Import ${goodImport} draft${goodImport === 1 ? "" : "s"}` : "Close"}
        onCancel={() => setImportPreview(null)}
        onConfirm={() => {
          if (goodImport) void commitImport();
          else setImportPreview(null);
        }}
      />
    </div>
  );
}

function InvoiceRow({
  invoice,
  checked,
  result,
  onToggle,
  onOpen,
}: {
  invoice: Invoice;
  checked: boolean;
  result?: { ok: boolean; message: string };
  onToggle: (on: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <tr className="clickable" onClick={onOpen}>
      <td onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${invoice.usin}`}
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
        />
      </td>
      <td>
        <Link
          to={sectionPath(`/invoices/${invoice.id}`)}
          className="mono cell-link"
          onClick={(event) => event.stopPropagation()}
        >
          {invoice.usin}
        </Link>
      </td>
      <td>{invoice.buyerName || "—"}</td>
      <td className="mono">{invoice.dateTime}</td>
      <td>{pkr(invoice.totalBillAmount)}</td>
      <td className="mono">{invoice.fiscalNumber || "—"}</td>
      <td>
        <Badge tone={invoice.status}>{invoice.inFlight ? `${invoice.status} · sending` : invoice.status}</Badge>
      </td>
      <td>{result ? <span className={result.ok ? "tone-ok" : "tone-late"}>{result.message}</span> : "—"}</td>
    </tr>
  );
}
