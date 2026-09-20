import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { useDesk } from "../context/DeskContext";
import { registrationDisplay } from "../domain/clients";
import { sectionPath } from "../domain/nav";
import {
  buildWorkQueue,
  filterWorkQueue,
  stageCounts,
  STAGE_LABEL,
  WORK_STAGES,
  type ClientWorkRow,
  type WorkStage,
  type WorkStageFilter,
} from "../domain/today";
import { db } from "../db";
import { useLiveState } from "../hooks/useLive";
import { dueDates, periodLabel } from "../lib/ids";
import { returnStatusLabel } from "../lib/statusLabel";
import type { Invoice, PsidRecord, ReturnPeriod } from "../types";

const PAGE_SIZE = 50;

function isStageFilter(value: string | null): value is WorkStageFilter {
  return value === "all" || value === "open" || WORK_STAGES.includes(value as WorkStage);
}

function daysText(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} late`;
  if (days === 0) return "due today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

function dueTone(days: number): string {
  if (days < 0) return "due-chip late";
  if (days <= 3) return "due-chip soon";
  return "due-chip";
}

export function TodayPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { ready, clients, period, chooseClient, client: openClient } = useDesk();

  // Only what is still waiting is loaded: posted invoices never reach this screen.
  const openState = useLiveState(
    () => db.invoices.where("status").anyOf("draft", "validated", "failed", "unknown").toArray(),
    [] as Invoice[],
    [],
  );
  const psidState = useLiveState(
    () => db.psids.where("period").equals(period).toArray(),
    [] as PsidRecord[],
    [period],
  );
  const returnState = useLiveState(
    () => db.returns.where("period").equals(period).toArray(),
    [] as ReturnPeriod[],
    [period],
  );

  const rawStage = params.get("stage");
  const stage: WorkStageFilter = isStageFilter(rawStage) ? rawStage : "open";
  const text = params.get("q") ?? "";
  // Page resets whenever the list it pages over changes.
  const listKey = `${stage}|${text}|${period}`;
  const [paging, setPaging] = useState({ key: listKey, page: 0 });
  const page = paging.key === listKey ? paging.page : 0;
  const setPage = (next: number) => setPaging({ key: listKey, page: next });

  const queue = useMemo(
    () =>
      buildWorkQueue({
        clients,
        openInvoices: openState.data,
        psids: psidState.data,
        returns: returnState.data,
        period,
      }),
    [clients, openState.data, psidState.data, returnState.data, period],
  );
  const counts = useMemo(() => stageCounts(queue), [queue]);
  const shown = useMemo(() => filterWorkQueue(queue, { stage, text }), [queue, stage, text]);
  const waiting = queue.length - counts.done;
  const late = queue.filter((row) => row.overdue).length;

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const dues = dueDates(period);

  function patch(next: { stage?: WorkStageFilter; q?: string }) {
    const merged = new URLSearchParams(params);
    if (next.stage !== undefined) {
      if (next.stage === "open") merged.delete("stage");
      else merged.set("stage", next.stage);
    }
    if (next.q !== undefined) {
      if (next.q.trim()) merged.set("q", next.q);
      else merged.delete("q");
    }
    setParams(merged, { replace: true });
  }

  async function open(row: ClientWorkRow) {
    await chooseClient(row.client.id);
    navigate(sectionPath(row.path));
  }

  if (!ready || !openState.ready) {
    return (
      <div className="stack" aria-busy="true" aria-label="Loading today's work">
        <Skeleton variant="kpi" lines={4} />
        <Skeleton lines={6} />
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="stack">
        <PageHeader kicker={periodLabel(period)} title="Today" />
        <EmptyState
          title="No clients yet"
          body="Add your first client file. Everything that needs doing for every client will show up here."
          action={
            <Link className="btn stamp" to={sectionPath("/clients")}>
              Add a client
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="stack today">
      <PageHeader
        kicker={periodLabel(period)}
        title="Today"
        description={
          <>
            {waiting === 0
              ? "Every client is up to date for this month."
              : `${waiting} of ${queue.length} client${queue.length === 1 ? "" : "s"} still need something.`}
            {late > 0 ? <strong className="today-late"> {late} past a deadline.</strong> : null}
          </>
        }
        actions={
          <>
            <span className={dueTone(queue[0]?.daysToPayment ?? 0)}>
              Pay by {dues.payment} · {daysText(queue[0]?.daysToPayment ?? 0)}
            </span>
            <span className={dueTone(queue[0]?.daysToReturn ?? 0)}>
              File by {dues.returnDue} · {daysText(queue[0]?.daysToReturn ?? 0)}
            </span>
          </>
        }
      />

      <div className="status-pills" role="group" aria-label="Filter clients by what they need">
        <button
          type="button"
          className={stage === "open" ? "status-pill on" : "status-pill"}
          aria-pressed={stage === "open"}
          onClick={() => patch({ stage: "open" })}
        >
          Needs work<span>{waiting}</span>
        </button>
        {WORK_STAGES.map((value) => (
          <button
            key={value}
            type="button"
            className={stage === value ? `status-pill on stage-${value}` : `status-pill stage-${value}`}
            aria-pressed={stage === value}
            onClick={() => patch({ stage: value })}
          >
            {STAGE_LABEL[value]}
            <span>{counts[value]}</span>
          </button>
        ))}
        <button
          type="button"
          className={stage === "all" ? "status-pill on" : "status-pill"}
          aria-pressed={stage === "all"}
          onClick={() => patch({ stage: "all" })}
        >
          All clients<span>{queue.length}</span>
        </button>
      </div>

      <label className="today-search">
        <span className="sr-only">Find a client by name or PNTN</span>
        <input
          type="search"
          value={text}
          placeholder="Find a client by name or PNTN"
          onChange={(event) => patch({ q: event.target.value })}
        />
      </label>

      {shown.length === 0 ? (
        <EmptyState
          title={text ? "No client matches" : "Nothing here"}
          body={
            text
              ? "Try a shorter name, or part of the PNTN."
              : stage === "open"
                ? "No client is waiting on anything for this month."
                : "No client is at this step right now."
          }
          action={
            text || stage !== "all" ? (
              <button className="btn ghost" type="button" onClick={() => setParams({}, { replace: true })}>
                Show clients that need work
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="table-wrap today-table">
          <table>
            <caption className="sr-only">Clients and the next step for each, most urgent first</caption>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Next step</th>
                <th scope="col" className="num">Unclear</th>
                <th scope="col" className="num">Failed</th>
                <th scope="col" className="num">To send</th>
                <th scope="col" className="num">PSID unpaid</th>
                <th scope="col">Return</th>
                <th scope="col"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.client.id} className={row.overdue ? "is-late" : undefined}>
                  <th scope="row" data-label="Client">
                    <span className="today-name">{row.client.businessName}</span>
                    <small className="muted">
                      {registrationDisplay(row.client) || "No PNTN"}
                      {row.client.id === openClient?.id ? " · open now" : ""}
                    </small>
                  </th>
                  <td data-label="Next step">
                    <span className={`stage-tag stage-${row.stage}`}>{STAGE_LABEL[row.stage]}</span>
                    <span className="today-step">{row.nextStep}</span>
                    {row.overdue ? <span className="due-chip late">Late</span> : null}
                  </td>
                  <td data-label="Unclear" className={row.unclear ? "num bad" : "num muted"}>{row.unclear}</td>
                  <td data-label="Failed" className={row.failed ? "num bad" : "num muted"}>{row.failed}</td>
                  <td data-label="To send" className={row.toPost ? "num" : "num muted"}>{row.toPost}</td>
                  <td data-label="PSID unpaid" className={row.psidOpen ? "num" : "num muted"}>{row.psidOpen}</td>
                  <td data-label="Return">
                    <Badge tone={row.returnStatus}>{returnStatusLabel(row.returnStatus)}</Badge>
                  </td>
                  <td className="today-go">
                    <button className="btn ghost" type="button" onClick={() => void open(row)}>
                      Open<span className="sr-only"> {row.client.businessName}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <nav className="row today-pager" aria-label="Pages">
          <button className="btn ghost" type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span className="muted" aria-live="polite">
            {current * PAGE_SIZE + 1}–{Math.min(shown.length, (current + 1) * PAGE_SIZE)} of {shown.length}
          </span>
          <button
            className="btn ghost"
            type="button"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}
