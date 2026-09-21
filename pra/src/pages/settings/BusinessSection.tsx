import { useEffect, useState } from "react";
import { Notice } from "../../components/Notice";
import { Panel } from "../../components/Panel";
import { TokenField } from "../../components/TokenField";
import { useDesk } from "../../context/DeskContext";
import { useNotice } from "../../context/NoticeContext";
import { apiRole, hasApiToken } from "../../lib/apiSync";
import {
  createBusinessUser,
  listBusinessUsers,
  resetBusinessPassword,
  setBusinessDisabled,
  type BusinessRow,
} from "../../lib/businessApi";

export function BusinessSection() {
  const { clients } = useDesk();
  const { push } = useNotice();
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    if (!hasApiToken() || apiRole() !== "owner") {
      setError("Sign in as owner under Settings → Backup first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setRows(await listBusinessUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load business users.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate() {
    if (!clientId) {
      push("bad", "Pick the client file for this login.");
      return;
    }
    setBusy(true);
    try {
      await createBusinessUser(email.trim(), password, clientId);
      setEmail("");
      setPassword("");
      push("good", "Business login created.");
      await refresh();
    } catch (err) {
      push("bad", err instanceof Error ? err.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  const activeClients = clients.filter((c) => !c.archived);

  return (
    <Panel title="Business logins">
      <div id="business" className="stack">
        <p className="muted" style={{ margin: 0 }}>
          Owner only. One login tied to one client file. That business can invoice and post for
          itself only — not staff tools, backups, or other clients.
        </p>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <div className="row">
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Loading…" : "Refresh"}
          </button>
        </div>

        <h4 style={{ marginBottom: 0 }}>New business user</h4>
        <div className="form-grid">
          <label>
            Client file
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select…</option>
              {activeClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.businessName || c.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </label>
          <TokenField label="Temporary password" value={password} onChange={setPassword} />
        </div>
        <button
          className="btn stamp"
          type="button"
          disabled={busy || !email.trim() || password.length < 8 || !clientId}
          onClick={() => void onCreate()}
        >
          Create business login
        </button>

        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((row) => {
            const clientName =
              clients.find((c) => c.id === row.clientId)?.businessName || row.clientId || "—";
            return (
              <li key={row.id} className="panel" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div>
                    <strong>{row.email}</strong>
                    <div className="muted">
                      {clientName}
                      {row.disabled ? " · disabled" : ""}
                    </div>
                  </div>
                  <div className="row">
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const next = window.prompt("New password (min 8 characters)");
                        if (!next || next.length < 8) return;
                        void (async () => {
                          setBusy(true);
                          try {
                            await resetBusinessPassword(row.id, next);
                            push("good", "Password reset. They must sign in again.");
                            await refresh();
                          } catch (err) {
                            push("bad", err instanceof Error ? err.message : "Reset failed.");
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                    >
                      Reset password
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          setBusy(true);
                          try {
                            await setBusinessDisabled(row.id, !row.disabled);
                            push(
                              "good",
                              row.disabled ? "Business login enabled." : "Disabled and logged out.",
                            );
                            await refresh();
                          } catch (err) {
                            push("bad", err instanceof Error ? err.message : "Update failed.");
                          } finally {
                            setBusy(false);
                          }
                        })()
                      }
                    >
                      {row.disabled ? "Enable" : "Disable"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {!rows.length && !error ? <p className="muted">No business logins yet.</p> : null}
      </div>
    </Panel>
  );
}
