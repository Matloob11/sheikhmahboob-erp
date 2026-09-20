import { Badge } from "../../components/Badge";
import { EmptyState } from "../../components/EmptyState";
import { registrationDisplay } from "../../domain/clients";
import { emptyListCopy } from "../../domain/masterPane";
import { STAGE_LABEL, type ClientWorkRow } from "../../domain/today";
import { returnStatusLabel } from "../../lib/statusLabel";
import { PAGE_SIZE } from "./helpers";

type ClientsListProps = {
  period: string;
  query: string;
  shown: ClientWorkRow[];
  rows: ClientWorkRow[];
  openFileId: string | undefined;
  pageCount: number;
  current: number;
  setPage: (next: number) => void;
  onOpenRow: (row: ClientWorkRow) => void;
  onStartNew: () => void;
};

export function ClientsList({
  period,
  query,
  shown,
  rows,
  openFileId,
  pageCount,
  current,
  setPage,
  onOpenRow,
  onStartNew,
}: ClientsListProps) {
  if (shown.length === 0) {
    return (
      <EmptyState
        title={emptyListCopy(Boolean(query.trim()), "clients")}
        body={
          query.trim()
            ? "Clear the search to see every file on this desk."
            : "Add a taxpayer file, or import a backup from Settings."
        }
        action={
          <button className="btn stamp" type="button" onClick={onStartNew}>
            New client
          </button>
        }
      />
    );
  }

  return (
    <>
      <div className="table-wrap today-table">
        <table>
          <caption className="sr-only">Client files and work status for {period}</caption>
          <thead>
            <tr>
              <th scope="col">Client</th>
              <th scope="col">Next step</th>
              <th scope="col" className="num">
                Unclear
              </th>
              <th scope="col" className="num">
                Failed
              </th>
              <th scope="col" className="num">
                To send
              </th>
              <th scope="col" className="num">
                PSID unpaid
              </th>
              <th scope="col">Return</th>
              <th scope="col">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.client.id}
                className={
                  [row.client.id === openFileId ? "is-open" : "", row.overdue ? "is-late" : ""]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                <th scope="row" data-label="Client">
                  <button className="link-btn" type="button" onClick={() => onOpenRow(row)}>
                    <span className="today-name">{row.client.businessName}</span>
                  </button>
                  <small className="muted">
                    {registrationDisplay(row.client) || "No PNTN"}
                    {row.client.archived ? " · Archived" : ""}
                  </small>
                </th>
                <td data-label="Next step">
                  <span className={`stage-tag stage-${row.stage}`}>{STAGE_LABEL[row.stage]}</span>
                  <span className="today-step">{row.nextStep}</span>
                  {row.overdue ? <span className="due-chip late">Late</span> : null}
                </td>
                <td data-label="Unclear" className={row.unclear ? "num bad" : "num muted"}>
                  {row.unclear}
                </td>
                <td data-label="Failed" className={row.failed ? "num bad" : "num muted"}>
                  {row.failed}
                </td>
                <td data-label="To send" className={row.toPost ? "num" : "num muted"}>
                  {row.toPost}
                </td>
                <td data-label="PSID unpaid" className={row.psidOpen ? "num" : "num muted"}>
                  {row.psidOpen}
                </td>
                <td data-label="Return">
                  <Badge tone={row.returnStatus}>{returnStatusLabel(row.returnStatus)}</Badge>
                </td>
                <td className="today-go">
                  <button className="btn ghost" type="button" onClick={() => onOpenRow(row)}>
                    Open<span className="sr-only"> {row.client.businessName}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <nav className="row today-pager" aria-label="Pages">
          <button
            className="btn ghost"
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
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
    </>
  );
}
