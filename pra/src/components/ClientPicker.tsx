import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";
import { sectionPath } from "../domain/nav";
import type { Client, Invoice } from "../types";

export function ClientPicker({
  title = "Select a client",
  body = "Choose a client, then continue with invoices, returns, or payments.",
  clients,
  invoices,
  selectedId,
  onSelect,
}: {
  title?: string;
  body?: string;
  clients: ReadonlyArray<Client>;
  invoices: ReadonlyArray<Invoice>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((row) => {
      const hay = `${row.businessName} ${row.pntn} ${row.city}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [clients, query]);

  if (clients.length === 0) {
    return (
      <EmptyState
        title={title}
        body={body}
        action={
          <Link className="btn stamp" to={sectionPath("/clients")}>
            Add client
          </Link>
        }
      />
    );
  }

  return (
    <div className="stack">
      <div>
        <h2 className="page-title" style={{ margin: 0 }}>
          {title}
        </h2>
        <p className="muted page-desc">{body}</p>
      </div>
      {clients.length > 4 ? (
        <input
          className="client-search"
          type="search"
          placeholder="Search name or PNTN"
          aria-label="Search clients"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      <div className="picker-grid">
        {visible.map((row) => {
          const count = invoices.filter((invoice) => invoice.clientId === row.id).length;
          const posted = invoices.filter(
            (invoice) => invoice.clientId === row.id && invoice.status === "posted",
          ).length;
          return (
            <button
              key={row.id}
              type="button"
              className={row.id === selectedId ? "picker-card on" : "picker-card"}
              onClick={() => onSelect(row.id)}
            >
              <strong>{row.businessName}</strong>
              <span className="muted mono">{row.pntn || "No PNTN"}</span>
              <span className="muted">{[row.city, row.sector].filter(Boolean).join(" · ")}</span>
              <Badge tone={row.environment}>{row.environment}</Badge>
              <span className="counts">
                {count} invoice{count === 1 ? "" : "s"} · {posted} posted
              </span>
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? <p className="muted">No clients match that search.</p> : null}
    </div>
  );
}
