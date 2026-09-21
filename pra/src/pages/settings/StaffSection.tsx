import { useEffect, useState } from "react";
import { Notice } from "../../components/Notice";
import { Panel } from "../../components/Panel";
import { TokenField } from "../../components/TokenField";
import { useDesk } from "../../context/DeskContext";
import { useNotice } from "../../context/NoticeContext";
import { hasApiToken } from "../../lib/apiSync";
import {
  assignStaff,
  createStaff,
  listAssignments,
  listStaff,
  resetStaffPassword,
  setStaffDisabled,
  unassignStaff,
  type StaffRow,
} from "../../lib/staffApi";

export function StaffSection() {
  const { clients } = useDesk();
  const { push } = useNotice();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [assignments, setAssignments] = useState<Array<{ client_id: string; user_id: string }>>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    if (!hasApiToken()) {
      setError("Sign in under Settings → Backup first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setStaff(await listStaff());
      setAssignments(await listAssignments());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load staff.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate() {
    setBusy(true);
    try {
      await createStaff(email.trim(), password);
      setEmail("");
      setPassword("");
      push("good", "Staff user created.");
      await refresh();
    } catch (err) {
      push("bad", err instanceof Error ? err.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Staff">
      <div id="staff" className="stack">
        <p className="muted" style={{ margin: 0 }}>
          Owner only. Create staff, assign client files, reset passwords, or disable a login. Every
          change is written to the audit log.
        </p>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <div className="row">
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Loading…" : "Refresh"}
          </button>
        </div>

        <h4 style={{ marginBottom: 0 }}>New staff</h4>
        <div className="form-grid">
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </label>
          <TokenField label="Temporary password" value={password} onChange={setPassword} />
        </div>
        <button className="btn stamp" type="button" disabled={busy || !email || password.length < 8} onClick={() => void onCreate()}>
          Create staff
        </button>

        <h4 style={{ marginBottom: 0 }}>Existing</h4>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {staff.map((row) => (
            <li key={row.id} className="stack" style={{ borderTop: "1px solid var(--line, #ddd)", paddingTop: 12, marginTop: 12 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  {row.email}{" "}
                  <span className="muted mono">{row.disabled ? "disabled" : "active"}</span>
                </span>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() =>
                    void setStaffDisabled(row.id, !row.disabled)
                      .then(() => {
                        push("good", row.disabled ? "Enabled." : "Disabled — logged out now.");
                        return refresh();
                      })
                      .catch((err: unknown) =>
                        push("bad", err instanceof Error ? err.message : "Update failed."),
                      )
                  }
                >
                  {row.disabled ? "Enable" : "Disable"}
                </button>
              </div>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  const next = window.prompt("New password (min 8 characters)");
                  if (!next || next.length < 8) return;
                  void resetStaffPassword(row.id, next)
                    .then(() => push("good", "Password reset. They must sign in again."))
                    .catch((err: unknown) =>
                      push("bad", err instanceof Error ? err.message : "Reset failed."),
                    );
                }}
              >
                Reset password
              </button>
              <p className="muted" style={{ margin: 0 }}>
                Assigned files:
              </p>
              <ul>
                {clients.map((client) => {
                  const on = assignments.some(
                    (a) => a.user_id === row.id && a.client_id === client.id,
                  );
                  return (
                    <li key={client.id} className="row" style={{ justifyContent: "space-between" }}>
                      <span>{client.businessName}</span>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() =>
                          void (on ? unassignStaff(row.id, client.id) : assignStaff(row.id, client.id))
                            .then(() => refresh())
                            .catch((err: unknown) =>
                              push("bad", err instanceof Error ? err.message : "Assign failed."),
                            )
                        }
                      >
                        {on ? "Remove" : "Assign"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
