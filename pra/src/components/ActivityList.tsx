import { useMemo, useState } from "react";
import { sanitizeActivityRows } from "../domain/activity";
import { db } from "../db";
import { exportReportCsv } from "../lib/reportExport";
import type { DeskEvent, EventKind } from "../types";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "backup", label: "Backup" },
  { id: "returns", label: "Returns" },
  { id: "invoices", label: "Invoices" },
  { id: "psid", label: "PSID" },
  { id: "files", label: "Files" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const KIND_MARK: Record<string, string> = {
  backup: "Bk",
  return: "Rt",
  purchase: "A",
  invoice: "Inv",
  psid: "Ps",
  client: "Cl",
  buyer: "By",
  item: "It",
  pct: "Hs",
};

function punchTime(ms: number): string {
  return new Date(ms).toLocaleString("en-PK", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function family(kind: EventKind): string {
  return kind.split(".")[0] ?? kind;
}

function matches(kind: EventKind, filter: FilterId): boolean {
  if (filter === "all") return true;
  if (filter === "backup") return kind.startsWith("backup.");
  if (filter === "returns") return kind.startsWith("return.") || kind.startsWith("purchase.");
  if (filter === "invoices") return kind.startsWith("invoice.");
  if (filter === "psid") return kind.startsWith("psid.");
  return (
    kind.startsWith("client.") ||
    kind.startsWith("buyer.") ||
    kind.startsWith("item.") ||
    kind.startsWith("pct.")
  );
}

export function ActivityList({
  events,
  empty = "No activity yet.",
}: {
  events: ReadonlyArray<DeskEvent>;
  empty?: string;
}) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [extra, setExtra] = useState<DeskEvent[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const merged = useMemo(() => {
    const seen = new Set(events.map((row) => row.id));
    return [...events, ...extra.filter((row) => !seen.has(row.id))];
  }, [events, extra]);

  const visible = useMemo(
    () => merged.filter((event) => matches(event.kind, filter)),
    [merged, filter],
  );

  async function loadMore() {
    setBusy(true);
    try {
      const more = await db.events.orderBy("createdAt").reverse().offset(merged.length).limit(200).toArray();
      if (more.length < 200) setDone(true);
      setExtra((current) => [...current, ...more]);
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const rows = sanitizeActivityRows(visible);
    exportReportCsv(
      "daftar-activity.csv",
      ["createdAt", "kind", "title", "detail", "clientId"],
      rows.map((row) => [row.createdAt, row.kind, row.title, row.detail, row.clientId]),
    );
  }

  if (merged.length === 0) {
    return <p className="muted">{empty}</p>;
  }

  return (
    <div className="stack">
      <div className="row" role="group" aria-label="Activity filters">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            className={filter === item.id ? "btn stamp" : "btn ghost"}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button className="btn ghost" type="button" onClick={exportCsv}>
          Export CSV
        </button>
      </div>
      {visible.length === 0 ? (
        <p className="muted">No {filter} rows in recent activity.</p>
      ) : (
        <ol className="activity">
          {visible.map((event) => {
            const mark = KIND_MARK[family(event.kind)] ?? family(event.kind).slice(0, 2);
            return (
              <li key={event.id}>
                <time className="mono" dateTime={new Date(event.createdAt).toISOString()}>
                  {punchTime(event.createdAt)}
                </time>
                <strong>
                  <span className="mono muted" aria-hidden>
                    {mark}
                    {" · "}
                  </span>
                  {event.title}
                </strong>
                {event.detail ? <span className="muted">{event.detail}</span> : null}
                <em className="mono">{event.kind}</em>
              </li>
            );
          })}
        </ol>
      )}
      {!done ? (
        <button className="btn ghost" type="button" disabled={busy} onClick={() => void loadMore()}>
          {busy ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}
