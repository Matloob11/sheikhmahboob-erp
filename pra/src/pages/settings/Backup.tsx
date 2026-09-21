import { useEffect, useState } from "react";
import { Confirm } from "../../components/Confirm";
import { Notice } from "../../components/Notice";
import { Panel } from "../../components/Panel";
import { TokenField } from "../../components/TokenField";
import { useDesk } from "../../context/DeskContext";
import { useNotice } from "../../context/NoticeContext";
import { hasPracticePin, lockPractice } from "../../domain/settings";
import {
  applyBackup,
  buildServerPushBackup,
  exportBackup,
  parseBackupText,
  prepareImport,
  previewBackup,
  type BackupPreview,
  type DeskBackup,
  type ImportMode,
} from "../../lib/backup";
import {
  clearStoredConflicts,
  isSyncDirty,
  readStoredConflicts,
  syncQueueDepth,
  type SyncConflict,
} from "../../lib/apiSync";
import type { DeskEvent } from "../../types";

const API_URL_KEY = "daftar.apiBase";
const API_EMAIL_KEY = "daftar.apiEmail";

function defaultApiBase(): string {
  const stored = localStorage.getItem(API_URL_KEY);
  if (stored) return stored;
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_DAFTAR_API) {
    return import.meta.env.VITE_DAFTAR_API;
  }
  if (typeof location !== "undefined" && /sheikhmahboob\.com$/i.test(location.hostname)) {
    return "https://sheikhmahboob.com/pra-api/v1";
  }
  return "http://127.0.0.1:8787/v1";
}

function lastImported(events: ReadonlyArray<DeskEvent>): DeskEvent | undefined {
  return events.find((event) => event.kind === "backup.imported");
}

function when(ms: number): string {
  return new Date(ms).toLocaleString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BackupSection() {
  const { events, client } = useDesk();
  const { push } = useNotice();
  const [tokenMode, setTokenMode] = useState<"encrypt" | "strip">("encrypt");
  const [exportPassword, setExportPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [pending, setPending] = useState<{ backup: DeskBackup; preview: BackupPreview; name: string } | null>(
    null,
  );
  const [apiBase, setApiBase] = useState(defaultApiBase);
  const [apiEmail, setApiEmail] = useState(() => localStorage.getItem(API_EMAIL_KEY) ?? "");
  const [apiPassword, setApiPassword] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [conflicts, setConflicts] = useState<SyncConflict[]>(() => readStoredConflicts());
  const [queueDepth, setQueueDepth] = useState(() => syncQueueDepth());
  const [dirty, setDirty] = useState(() => isSyncDirty());
  const imported = lastImported(events);

  useEffect(() => {
    const tick = () => {
      setConflicts(readStoredConflicts());
      setQueueDepth(syncQueueDepth());
      setDirty(isSyncDirty());
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, []);

  async function onExport() {
    try {
      await exportBackup({ tokenMode, password: tokenMode === "encrypt" ? exportPassword : undefined });
      window.dispatchEvent(new Event("daftar:backup-exported"));
      setExportPassword("");
      push("info", tokenMode === "encrypt" ? "Encrypted desk backup downloaded." : "Desk backup downloaded with tokens stripped.");
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Export failed.";
      push("bad", text);
    }
  }

  async function onPickImport(file: File) {
    try {
      const backup = parseBackupText(await file.text());
      setPending({ backup, preview: previewBackup(backup), name: file.name });
      setImportPassword("");
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "This file is not a Daftar backup.";
      push("bad", text);
    }
  }

  async function onImport(mode: ImportMode) {
    if (!pending) return;
    try {
      const ready = await prepareImport(pending.backup, importPassword);
      await applyBackup(ready, mode);
      if (hasPracticePin(ready.settings)) lockPractice();
      setPending(null);
      setImportPassword("");
      push("good", mode === "merge" ? "Backup merged by id." : "Backup imported.");
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Import failed.";
      push("bad", text);
    }
  }

  async function onPushToServer() {
    const base = apiBase.replace(/\/$/, "");
    if (!apiEmail.trim() || !apiPassword) {
      push("bad", "Enter API email and password to push.");
      return;
    }
    setPushBusy(true);
    localStorage.setItem(API_URL_KEY, base);
    localStorage.setItem(API_EMAIL_KEY, apiEmail.trim());
    try {
      const loginRes = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ email: apiEmail.trim(), password: apiPassword }),
      });
      if (!loginRes.ok) {
        throw new Error(loginRes.status === 423 ? "API account locked. Try later." : "API login failed.");
      }
      const loginBody = (await loginRes.json()) as { token?: string };
      if (!loginBody.token) throw new Error("API login returned no token.");
      const backup = await buildServerPushBackup();
      const importRes = await fetch(`${base}/import/desk-backup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${loginBody.token}`,
        },
        credentials: "omit",
        body: JSON.stringify(backup),
      });
      if (!importRes.ok) {
        const detail = await importRes.text().catch(() => "");
        throw new Error(detail || "Push to server failed.");
      }
      const result = (await importRes.json()) as {
        counts?: { clients?: number; invoices?: number };
      };
      const clients = result.counts?.clients ?? 0;
      const invoices = result.counts?.invoices ?? 0;
      setApiPassword("");
      push("good", `Copy pushed to server — ${clients} client(s), ${invoices} invoice(s).`);
    } catch (error: unknown) {
      const text =
        error instanceof TypeError
          ? "API unreachable. Is daftar-api running on this PC?"
          : error instanceof Error
            ? error.message
            : "Push failed.";
      push("bad", text);
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <Panel title="Backup">
      <div id="backup" className="stack">
        <p className="muted" style={{ margin: 0 }}>
          Export clients, invoices, purchases, returns, PSIDs, buyers, items and activity. Tokens are either
          encrypted with a password or stripped — they are never written in full in a new backup.
        </p>
        {imported ? (
          <Notice tone="info">
            Last restore on this browser: {when(imported.createdAt)} — {imported.title}. Exports are not
            written to activity; the downloaded JSON is the record.
          </Notice>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            No restore recorded on this browser. Export after month-end. This desk does not log downloads.
          </p>
        )}
        <label className="row">
          <input
            type="radio"
            name="token-mode"
            checked={tokenMode === "encrypt"}
            onChange={() => setTokenMode("encrypt")}
          />
          Encrypt tokens with a password
        </label>
        <label className="row">
          <input
            type="radio"
            name="token-mode"
            checked={tokenMode === "strip"}
            onChange={() => setTokenMode("strip")}
          />
          Strip tokens from the file
        </label>
        {tokenMode === "encrypt" ? (
          <TokenField
            label="Backup password"
            value={exportPassword}
            onChange={setExportPassword}
            autoComplete="new-password"
            hint="Needed later to restore eIMS tokens. Not the practice PIN unless you choose the same value."
          />
        ) : null}
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => void onExport()}>
            Export desk backup
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={!client}
            onClick={() => {
              if (!client) return;
              void exportBackup({
                tokenMode,
                password: tokenMode === "encrypt" ? exportPassword : undefined,
                clientId: client.id,
              })
                .then(() => {
                  window.dispatchEvent(new Event("daftar:backup-exported"));
                  push("info", "This client file was downloaded.");
                })
                .catch((error: unknown) => push("bad", error instanceof Error ? error.message : "Export failed."));
            }}
          >
            Export open client
          </button>
          <label className="btn ghost">
            Import backup
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onPickImport(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <hr style={{ border: 0, borderTop: "1px solid var(--line, #ddd)", margin: "0.5rem 0" }} />
        <p className="muted" style={{ margin: 0 }}>
          Push a copy to the local Daftar API (one-way). Desk stays on this browser. Default{" "}
          <span className="mono">http://127.0.0.1:8787/v1</span>.
        </p>
        <label className="stack" style={{ gap: "0.25rem" }}>
          <span className="muted">API base URL</span>
          <input
            className="input"
            value={apiBase}
            onChange={(event) => setApiBase(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="stack" style={{ gap: "0.25rem" }}>
          <span className="muted">API email</span>
          <input
            className="input"
            type="email"
            value={apiEmail}
            onChange={(event) => setApiEmail(event.target.value)}
            autoComplete="username"
          />
        </label>
        <TokenField
          label="API password"
          value={apiPassword}
          onChange={setApiPassword}
          autoComplete="current-password"
        />
        <div className="row">
          <button
            className="btn ghost"
            type="button"
            disabled={pushBusy}
            onClick={() => void onPushToServer()}
          >
            {pushBusy ? "Pushing…" : "Push copy to server"}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={pushBusy}
            onClick={() => {
              void (async () => {
                if (!apiEmail.trim() || !apiPassword) {
                  push("bad", "Enter API email and password to sync.");
                  return;
                }
                setPushBusy(true);
                try {
                  const { syncPushWithLogin } = await import("../../lib/apiSync");
                  localStorage.setItem(API_URL_KEY, apiBase.replace(/\/$/, ""));
                  localStorage.setItem(API_EMAIL_KEY, apiEmail.trim());
                  const result = await syncPushWithLogin(apiEmail.trim(), apiPassword);
                  setApiPassword("");
                  setConflicts(result.conflicts);
                  setQueueDepth(syncQueueDepth());
                  setDirty(isSyncDirty());
                  if (result.queued) {
                    push("info", "API unreachable — change queued. Desk stays usable offline.");
                  } else if (result.conflicts.length) {
                    push(
                      "bad",
                      `Synced with ${result.conflicts.length} conflict(s) — pushed ${result.applied}, pulled ${result.pulled}. Resolve below.`,
                    );
                  } else {
                    push("good", `Synced — pushed ${result.applied}, pulled ${result.pulled}.`);
                  }
                } catch (error: unknown) {
                  push("bad", error instanceof Error ? error.message : "Sync failed.");
                } finally {
                  setPushBusy(false);
                }
              })();
            }}
          >
            Sync now
          </button>
        </div>
      </div>

      {(dirty || queueDepth > 0) && (
        <Notice tone="info">
          Sync queue: {queueDepth || 1} pending change{queueDepth === 1 ? "" : "s"}
          {dirty ? " (dirty)" : ""}. Will drain when the API is online.
        </Notice>
      )}

      {conflicts.length > 0 && (
        <div className="stack" data-testid="sync-conflicts">
          <Notice tone="bad">
            {conflicts.length} sync conflict{conflicts.length === 1 ? "" : "s"} — not silently merged.
            Newest-wins still applies where safe; posted invoices are never downgraded.
          </Notice>
          <ul className="plain-list mono" style={{ fontSize: "0.85rem" }}>
            {conflicts.map((c) => (
              <li key={`${c.entity}-${c.id}-${c.reason}`}>
                {c.entity} <strong>{c.id}</strong>: {c.reason}
              </li>
            ))}
          </ul>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              clearStoredConflicts();
              setConflicts([]);
            }}
          >
            Dismiss conflicts
          </button>
        </div>
      )}

      <Confirm
        open={Boolean(pending)}
        title="Import this backup?"
        body={
          pending ? (
            <div>
              <p>
                <span className="mono">{pending.name}</span> holds {pending.preview.clients} client
                {pending.preview.clients === 1 ? "" : "s"}, {pending.preview.invoices} invoice
                {pending.preview.invoices === 1 ? "" : "s"}, {pending.preview.purchases} purchase
                {pending.preview.purchases === 1 ? "" : "s"}, {pending.preview.returns} return
                {pending.preview.returns === 1 ? "" : "s"}, {pending.preview.psids} PSID row
                {pending.preview.psids === 1 ? "" : "s"}, {pending.preview.buyers} buyer
                {pending.preview.buyers === 1 ? "" : "s"}, {pending.preview.items} item
                {pending.preview.items === 1 ? "" : "s"},                 {pending.preview.events} activity row
                {pending.preview.events === 1 ? "" : "s"}, {pending.preview.places} place
                {pending.preview.places === 1 ? "" : "s"}, {pending.preview.banks} bank
                {pending.preview.banks === 1 ? "" : "s"}, {pending.preview.posDevices} POS device
                {pending.preview.posDevices === 1 ? "" : "s"}.
              </p>
              <p>
                Tokens: {pending.preview.tokenHandling}
                {pending.preview.tokens ? ` · ${pending.preview.tokens} client token(s)` : ""}.
              </p>
              <p>Replace wipes this desk. Merge by id keeps local rows that are not in the file.</p>
              {pending.preview.tokenHandling === "encrypted" ? (
                <TokenField
                  label="Backup password"
                  value={importPassword}
                  onChange={setImportPassword}
                  autoComplete="current-password"
                />
              ) : null}
            </div>
          ) : (
            ""
          )
        }
        confirmLabel="Replace desk"
        danger
        onConfirm={() => void onImport("replace")}
        extraLabel="Merge by id"
        onExtra={() => void onImport("merge")}
        onCancel={() => {
          setPending(null);
          setImportPassword("");
        }}
      />
    </Panel>
  );
}
