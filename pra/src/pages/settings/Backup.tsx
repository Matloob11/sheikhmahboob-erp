import { useState } from "react";
import { Confirm } from "../../components/Confirm";
import { Notice } from "../../components/Notice";
import { Panel } from "../../components/Panel";
import { TokenField } from "../../components/TokenField";
import { useDesk } from "../../context/DeskContext";
import { useNotice } from "../../context/NoticeContext";
import { hasPracticePin, lockPractice } from "../../domain/settings";
import {
  applyBackup,
  exportBackup,
  parseBackupText,
  prepareImport,
  previewBackup,
  type BackupPreview,
  type DeskBackup,
  type ImportMode,
} from "../../lib/backup";
import type { DeskEvent } from "../../types";

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
  const imported = lastImported(events);

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
      </div>

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
