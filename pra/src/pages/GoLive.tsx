import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { sectionPath } from "../domain/nav";
import { looksLikeSandboxDemo } from "../components/GoLiveChecklist";
import { PRA_SANDBOX_TOKEN } from "../types";
import { hasApiToken } from "../lib/apiSync";
import { setClientPostingMode } from "../lib/postApi";

type Check = { id: string; label: string; ok: boolean; how: "auto" | "hand"; detail: string };

export function GoLivePage() {
  const { clientId } = useParams();
  const { clients, invoices } = useDesk();
  const { push } = useNotice();
  const client = clients.find((c) => c.id === clientId);
  const [busy, setBusy] = useState(false);

  const checks = useMemo((): Check[] => {
    if (!client) return [];
    const fileOk = Boolean(
      client.businessName.trim() &&
        (client.pntn.trim() || client.cnic.trim()) &&
        client.posId.trim(),
    );
    const tokenOk =
      Boolean(client.posToken.trim()) &&
      client.posToken.trim() !== PRA_SANDBOX_TOKEN &&
      !looksLikeSandboxDemo(client);
    const sandboxPosted = invoices.some(
      (inv) =>
        inv.clientId === client.id &&
        inv.status === "posted" &&
        (inv.postedEnvironment === "sandbox" || client.environment === "sandbox"),
    );
    const serverSandboxOk = Boolean(client.goLiveSandboxServerOkAt);
    return [
      {
        id: "file",
        label: "Client file complete",
        ok: fileOk,
        how: "auto",
        detail: fileOk ? "Name, registration and POS ID look present." : "Fill profile: name, PNTN/CNIC, POS ID.",
      },
      {
        id: "portal",
        label: "POS registered on reg.pra.punjab.gov.pk with IP 187.53.143.235",
        ok: client.goLivePosRegistered === true,
        how: "hand",
        detail: "Mark when Pos Details tab shows this server IP.",
      },
      {
        id: "token",
        label: "POS ID and live token entered (not sandbox demo)",
        ok: tokenOk,
        how: "auto",
        detail: tokenOk ? "Token is not the published sandbox sample." : "Paste the real eIMS token from POS registration.",
      },
      {
        id: "sandbox",
        label: "Sandbox test post passed",
        ok: sandboxPosted || serverSandboxOk,
        how: "auto",
        detail:
          sandboxPosted || serverSandboxOk
            ? "At least one sandbox post reached posted."
            : "Post one sandbox invoice first (browser or server).",
      },
      {
        id: "mode",
        label: `Posting mode: ${client.postingMode === "server" ? "server" : "browser"}`,
        ok: true,
        how: "auto",
        detail: "Default is browser until you switch after a server sandbox post.",
      },
      {
        id: "iris",
        label: "First live invoice checked on IRIS",
        ok: client.goLiveIrisChecked === true,
        how: "hand",
        detail: "Mark after you confirm the fiscal number on IMS Fiscal Report.",
      },
    ];
  }, [client, invoices]);

  if (!client) {
    return (
      <div className="stack">
        <PageHeader title="Go live" />
        <Notice tone="bad">Client not found.</Notice>
        <Link to={sectionPath("/clients")}>Back to clients</Link>
      </div>
    );
  }

  async function toggleHand(field: "goLivePosRegistered" | "goLiveIrisChecked") {
    const next = { ...client!, [field]: !client![field], updatedAt: Date.now() };
    await db.clients.put(next);
    notifyDb();
  }

  async function switchServer() {
    if (!hasApiToken()) {
      push("bad", "Sign in under Settings → Backup first.");
      return;
    }
    setBusy(true);
    try {
      const mode = await setClientPostingMode(client!.id, "server");
      await db.clients.put({ ...client!, postingMode: mode, updatedAt: Date.now() });
      notifyDb();
      push("good", "Posting mode → server.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Switch failed.";
      if (msg.includes("sandbox_server_post_required") || msg.includes("409")) {
        push(
          "bad",
          "Server mode needs a successful sandbox post through the API for this client first.",
        );
      } else {
        push("bad", msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const canOfferServer = client.postingMode !== "server" && Boolean(client.goLiveSandboxServerOkAt);

  return (
    <div className="stack">
      <PageHeader title={`Go live — ${client.businessName}`} />
      <p className="muted" style={{ margin: 0 }}>
        Do not switch to server posting until PRA whitelists 187.53.143.235 and this POS is
        registered.{" "}
        <Link to={sectionPath("/clients")}>Back</Link>
      </p>
      <Panel title="Checklist">
        <ol>
          {checks.map((check) => (
            <li key={check.id} style={{ marginBottom: 12 }}>
              <strong style={{ color: check.ok ? "inherit" : "var(--bad, #a00)" }}>
                {check.ok ? "✓" : "○"} {check.label}
              </strong>
              <div className="muted">{check.detail}</div>
              {check.how === "hand" ? (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() =>
                    void toggleHand(
                      check.id === "portal" ? "goLivePosRegistered" : "goLiveIrisChecked",
                    )
                  }
                >
                  {check.ok ? "Unmark" : "Mark done"}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
        {client.postingMode === "server" ? (
          <Notice tone="info">This file already uses server posting.</Notice>
        ) : (
          <button
            className="btn stamp"
            type="button"
            disabled={busy || !canOfferServer}
            onClick={() => void switchServer()}
          >
            {busy ? "Switching…" : "Switch to server posting"}
          </button>
        )}
        {!canOfferServer && client.postingMode !== "server" ? (
          <p className="muted">
            Server switch unlocks after a sandbox invoice is posted through the server queue for
            this client (API proof). Browser sandbox posts alone are not enough.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
