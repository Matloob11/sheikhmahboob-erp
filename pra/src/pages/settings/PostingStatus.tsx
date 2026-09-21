import { useEffect, useState } from "react";
import { Notice } from "../../components/Notice";
import { Panel } from "../../components/Panel";
import { useDesk } from "../../context/DeskContext";
import { useNotice } from "../../context/NoticeContext";
import { db } from "../../db";
import { notifyDb } from "../../hooks/useLive";
import { hasApiToken, logoutApi } from "../../lib/apiSync";
import {
  fetchOwnerPostStatus,
  postOutboxDepth,
  setClientPostingMode,
  type OwnerPostStatus,
} from "../../lib/postApi";
import { markLaptopBackupPulled } from "../../components/OwnerHealthBanner";

function ageHours(sec: number | null): string {
  if (sec == null) return "—";
  return `${(sec / 3600).toFixed(1)}h`;
}

export function PostingStatusSection() {
  const { clients } = useDesk();
  const { push } = useNotice();
  const [status, setStatus] = useState<OwnerPostStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState<string | null>(null);
  const [outbox, setOutbox] = useState(0);

  async function refresh() {
    setOutbox(postOutboxDepth());
    if (!hasApiToken()) {
      setError("Sign in under Settings → Backup first.");
      setStatus(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setStatus(await fetchOwnerPostStatus());
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Could not load status.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional once
  }, []);

  async function toggleMode(clientId: string, next: "browser" | "server") {
    setModeBusy(clientId);
    try {
      const mode = await setClientPostingMode(clientId, next);
      const row = await db.clients.get(clientId);
      if (row) {
        await db.clients.put({ ...row, postingMode: mode, updatedAt: Date.now() });
        notifyDb();
      }
      push("good", `${row?.businessName ?? clientId}: posting mode → ${mode}`);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Mode change failed.";
      push(
        "bad",
        msg.includes("sandbox_server_post_required")
          ? "Need a sandbox server post for this client first (see Go live)."
          : msg,
      );
    } finally {
      setModeBusy(null);
    }
  }

  return (
    <Panel title="Posting">
      <div id="posting" className="stack">
        <p className="muted" style={{ margin: 0 }}>
          Server posting is off by default (browser mode). Switch one client at a time after the
          whitelist is ready. /pra-ims stays until real sandbox posts are proven.
        </p>
        {outbox > 0 ? (
          <Notice tone="info">Local post outbox: {outbox} waiting for the API.</Notice>
        ) : null}
        <div className="row">
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Loading…" : "Refresh status"}
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              markLaptopBackupPulled();
              push("good", "Marked laptop backup pull time.");
            }}
          >
            Mark laptop backup pulled
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() =>
              void logoutApi().then(() => push("info", "Signed out of API on this computer."))
            }
          >
            Sign out of API
          </button>
        </div>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        {status ? (
          <div className="stack">
            <p style={{ margin: 0 }}>
              API {status.apiUp ? "up" : "DOWN"} · Postgres {status.postgresUp ? "up" : "DOWN"} ·
              server backup age {ageHours(status.newestBackupAgeSec)} · queue pending{" "}
              {status.depth.pending}, sending {status.depth.sending}, posted {status.depth.posted},
              failed {status.depth.failed}, unknown {status.depth.unknown}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Oldest pending age:{" "}
              {status.oldestPendingAgeSec == null ? "—" : `${status.oldestPendingAgeSec}s`}
            </p>
            {status.lastErrorByClient.length ? (
              <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
                {status.lastErrorByClient.map((row) => (
                  <li key={row.clientId}>
                    {row.businessName}: {row.lastError}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No recent client errors on the queue.
              </p>
            )}
          </div>
        ) : null}

        <h4 style={{ marginBottom: 0 }}>Per-client mode</h4>
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
          {clients.map((client) => {
            const mode = client.postingMode === "server" ? "server" : "browser";
            return (
              <li
                key={client.id}
                className="row"
                style={{ justifyContent: "space-between", gap: 12, marginBottom: 8 }}
              >
                <span>
                  {client.businessName}{" "}
                  <span className="muted mono">({mode})</span>
                </span>
                <button
                  className="btn ghost"
                  type="button"
                  disabled={modeBusy === client.id}
                  onClick={() =>
                    void toggleMode(client.id, mode === "server" ? "browser" : "server")
                  }
                >
                  {modeBusy === client.id
                    ? "…"
                    : mode === "server"
                      ? "Use browser"
                      : "Use server"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}
