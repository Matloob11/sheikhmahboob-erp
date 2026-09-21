import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Confirm } from "./Confirm";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { listPostRetryCandidates, submitInvoice } from "../domain/invoices";
import { peekTrash, restoreTrash } from "../domain/trash";
import { schemaUpgradeNotice } from "../lib/schemaNotice";
import {
  fireDueNotify,
  requestDueNotifyPermission,
  shouldFireDueNotify,
} from "../domain/dueNotify";
import { sectionPath } from "../domain/nav";
import {
  BACKUP_EXPORTED_EVENT,
  backupReminderState,
  browserStore,
  markBackupExported,
  snoozeBackupReminder,
} from "../domain/reminders";
import type { Invoice } from "../types";

export function LiveOpsHost({ children }: { children: ReactNode }) {
  const { client, clients, period } = useDesk();
  const { push } = useNotice();
  const hasClients = clients.length > 0;
  const [tick, setTick] = useState(0);
  const [schema, setSchema] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Invoice[]>([]);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const trash = peekTrash();
  const reminder = backupReminderState(new Date(), hasClients, browserStore());
  const notifyReady =
    typeof Notification !== "undefined" && Notification.permission === "granted";

  useEffect(() => {
    function onExport() {
      markBackupExported();
      setTick((value) => value + 1);
    }
    window.addEventListener(BACKUP_EXPORTED_EVENT, onExport);
    return () => window.removeEventListener(BACKUP_EXPORTED_EVENT, onExport);
  }, []);

  useEffect(() => {
    if (!notifyReady || !shouldFireDueNotify(period)) return;
    fireDueNotify(period);
  }, [notifyReady, period, tick]);

  useEffect(() => {
    setSchema(schemaUpgradeNotice(db.verno));
  }, []);

  useEffect(() => {
    function onOnline() {
      if (!client) return;
      void listPostRetryCandidates(client.id).then((rows) => {
        if (rows.length) setCandidates(rows);
      });
      void (async () => {
        const { drainSyncQueue, readStoredConflicts } = await import("../lib/apiSync");
        const { drainPostOutbox } = await import("../lib/postApi");
        const { applyPraResult, clearInvoiceInFlight } = await import("../domain/invoices");
        const result = await drainSyncQueue();
        const posts = await drainPostOutbox();
          for (const item of posts.finished) {
            const inv = await db.invoices.get(item.invoiceId);
            const owner = clients.find((c) => c.id === item.clientId) ?? client;
            if (inv && owner) {
              await db.invoices.put(applyPraResult(inv, item.result, owner));
              if (
                owner.environment === "sandbox" &&
                item.result.ok &&
                !owner.goLiveSandboxServerOkAt
              ) {
                await db.clients.put({
                  ...owner,
                  goLiveSandboxServerOkAt: Date.now(),
                  updatedAt: Date.now(),
                });
              }
              notifyDb();
            } else if (inv) {
              await clearInvoiceInFlight(inv);
            }
          }
        if (posts.sent) {
          push("good", `Flushed ${posts.sent} queued server post${posts.sent === 1 ? "" : "s"}.`);
        }
        if (!result) return;
        if (result.queued) {
          push("info", "API still unreachable — sync stays queued. Desk keeps working offline.");
          return;
        }
        if (result.conflicts.length || readStoredConflicts().length) {
          push(
            "bad",
            `Sync finished with ${result.conflicts.length || readStoredConflicts().length} conflict(s). Open Settings → Backup.`,
          );
        } else {
          push("good", `Synced — pushed ${result.applied}, pulled ${result.pulled}.`);
        }
      })();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [client, clients, push]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      void (async () => {
        const { drainSyncQueue, hasApiToken, isSyncDirty } = await import("../lib/apiSync");
        const { drainPostOutbox, postOutboxDepth } = await import("../lib/postApi");
        const { applyPraResult } = await import("../domain/invoices");
        if (hasApiToken() && postOutboxDepth() > 0) {
          const posts = await drainPostOutbox();
          for (const item of posts.finished) {
            const inv = await db.invoices.get(item.invoiceId);
            const owner = clients.find((c) => c.id === item.clientId);
            if (inv && owner) {
              await db.invoices.put(applyPraResult(inv, item.result, owner));
              notifyDb();
            }
          }
        }
        if (!hasApiToken() || !isSyncDirty()) return;
        const result = await drainSyncQueue();
        if (result && !result.queued && result.conflicts.length) {
          push("bad", `Sync conflicts: ${result.conflicts.length}. See Settings → Backup.`);
        }
      })();
    }, 120_000);
    return () => window.clearInterval(id);
  }, [clients, push]);

  async function enableDueNotify() {
    const permission = await requestDueNotifyPermission();
    if (permission === "granted") fireDueNotify(period);
    setTick((value) => value + 1);
  }

  async function runSandboxRetries() {
    if (!client || client.environment === "production") return;
    setRetryBusy(true);
    try {
      let sent = 0;
      for (const row of candidates) {
        if (row.status === "unknown") continue;
        const result = await submitInvoice(client, row);
        if (result.invoice.status === "posted") sent += 1;
      }
      if (sent) push("good", `Retried ${sent} sandbox post${sent === 1 ? "" : "s"}.`);
      else push("info", "No sandbox posts completed. Unclear USINs still need an IRIS check.");
      setCandidates([]);
      setTick((value) => value + 1);
    } finally {
      setRetryBusy(false);
      setConfirmRetry(false);
    }
  }

  const sandboxRetryable = candidates.filter((row) => row.status !== "unknown");
  const unclear = candidates.filter((row) => row.status === "unknown");

  return (
    <div className="stage-ops">
      {schema ? (
        <div className="alert info ops-strip" role="status">
          {schema}
        </div>
      ) : null}
      {candidates.length ? (
        <div className="alert info desk-banner ops-strip" role="status">
          <strong>
            {candidates.length} invoice{candidates.length === 1 ? "" : "s"} need attention after the
            network came back
          </strong>
          <p className="muted" style={{ margin: "6px 0" }}>
            {candidates
              .slice(0, 8)
              .map((row) => `${row.usin} (${row.status})`)
              .join(" · ")}
            {candidates.length > 8 ? " · …" : ""}
          </p>
          <div className="row">
            {client?.environment === "sandbox" && sandboxRetryable.length ? (
              <button
                className="btn stamp"
                type="button"
                disabled={retryBusy}
                onClick={() => setConfirmRetry(true)}
              >
                Review sandbox retries
              </button>
            ) : null}
            {client?.environment === "production" || unclear.length ? (
              <span className="muted">
                Production never auto-sends. Open each unclear USIN and reconcile from IRIS.
              </span>
            ) : null}
            <button className="btn ghost" type="button" onClick={() => setCandidates([])}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {trash ? (
        <div className="alert info ops-strip" role="status">
          <span>Undo remove {trash.label}?</span>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              void restoreTrash().then((label) => {
                if (label) setTick((value) => value + 1);
              });
            }}
          >
            Restore
          </button>
        </div>
      ) : null}
      {reminder.due ? (
        <div className="alert info desk-banner ops-strip" role="status">
          <strong>Backup is due</strong>
          <div className="row">
            <Link className="btn ghost" to={`${sectionPath("/settings")}#backup`}>
              Open backup
            </Link>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                markBackupExported();
                setTick((value) => value + 1);
              }}
            >
              Done
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                snoozeBackupReminder(3);
                setTick((value) => value + 1);
              }}
            >
              Later
            </button>
          </div>
        </div>
      ) : null}
      {typeof Notification !== "undefined" && Notification.permission === "default" ? (
        <div className="alert info desk-banner ops-strip" role="status">
          <strong>Due-date reminders</strong>
          <div className="row">
            <button className="btn ghost" type="button" onClick={() => void enableDueNotify()}>
              Turn on
            </button>
          </div>
        </div>
      ) : null}
      {children}
      <Confirm
        open={confirmRetry}
        title="Retry these sandbox posts?"
        body={
          <ul>
            {sandboxRetryable.map((row) => (
              <li key={row.id}>
                {row.usin} — {row.lastError || row.status}
              </li>
            ))}
          </ul>
        }
        confirmLabel={retryBusy ? "Sending…" : "Retry sandbox only"}
        onConfirm={() => void runSandboxRetries()}
        onCancel={() => setConfirmRetry(false)}
      />
    </div>
  );
}
