import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { AreaField, SelectField, TextInput } from "../components/Field";
import { Confirm } from "../components/Confirm";
import { Notice } from "../components/Notice";
import { NeedClient } from "../components/NeedClient";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import { psidCoverNote, type FileLedger } from "../domain/ledger";
import { sectionPath } from "../domain/nav";
import { removePsid, savePsid } from "../domain/psids";
import { db } from "../db";
import { useLive } from "../hooks/useLive";
import { parseAmount, pkr } from "../lib/money";
import type { ClientBank, PsidRecord, PsidStatus } from "../types";

function emptyForm() {
  return {
    id: "",
    amount: "",
    paidAmount: "",
    head: "Punjab sales tax on services",
    psid: "",
    cpr: "",
    bank: "",
    paidOn: "",
    dueOn: "",
    status: "planned" as PsidStatus,
    notes: "",
  };
}

function PsidGap({ ledger }: { ledger: FileLedger }) {
  const basis = Math.max(Math.abs(ledger.netPayable), Math.abs(ledger.psidPaid), 1);
  const netWidth = Math.min(100, (Math.abs(ledger.netPayable) / basis) * 100);
  const paidWidth = Math.min(100, (Math.abs(ledger.psidPaid) / basis) * 100);
  const cover = psidCoverNote({ netPayable: ledger.netPayable, psidPaid: ledger.psidPaid });

  return (
    <section className="psid-gap" aria-label="Ledger net versus recorded PSID">
      <article>
        <span>Ledger net payable</span>
        <b>{pkr(ledger.netPayable)}</b>
        <Link to={sectionPath("/returns")}>Returns</Link>
      </article>
      <article>
        <span>Paid + claimed</span>
        <b>{pkr(ledger.psidPaid)}</b>
        <span className="muted">From this register</span>
      </article>
      <article className={ledger.psidMismatch ? "mismatch" : undefined}>
        <span>Gap</span>
        <b>{pkr(ledger.psidGap)}</b>
        <Link to={sectionPath("/")}>Desk</Link>
      </article>
      <div className="psid-gap-bars" aria-hidden>
        <div>
          <span>Net</span>
          <i style={{ width: `${netWidth}%` }} />
        </div>
        <div>
          <span>Paid</span>
          <i className={ledger.psidMismatch ? "gap" : undefined} style={{ width: `${paidWidth}%` }} />
        </div>
      </div>
      {cover ? <p className="muted" style={{ margin: 0, gridColumn: "1 / -1" }}>{cover}</p> : null}
    </section>
  );
}

export function PsidsPage() {
  const { client, period, ledger } = useDesk();
  const { push } = useNotice();
  const [errors, setErrors] = useState<string[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [adding, setAdding] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const banks = useLive(
    () => (client ? db.clientBanks.where("clientId").equals(client.id).toArray() : Promise.resolve([] as ClientBank[])),
    [] as ClientBank[],
    [client?.id],
  );

  function loadRow(row: PsidRecord) {
    setForm({
      id: row.id,
      amount: String(row.amount),
      paidAmount: row.paidAmount != null ? String(row.paidAmount) : "",
      head: row.head,
      psid: row.psid,
      cpr: row.cpr,
      bank: row.bank,
      paidOn: row.paidOn,
      dueOn: row.dueOn ?? "",
      status: row.status,
      notes: row.notes,
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    const paidRaw = form.paidAmount.trim();
    const result = await savePsid({
      id: form.id || undefined,
      clientId: client.id,
      period,
      amount: parseAmount(form.amount),
      head: form.head,
      psid: form.psid,
      cpr: form.cpr,
      bank: form.bank,
      paidOn: form.paidOn,
      dueOn: form.dueOn,
      paidAmount: paidRaw === "" ? undefined : parseAmount(paidRaw),
      status: form.status,
      notes: form.notes,
    });
    setErrors(result.errors);
    if (result.errors.length) {
      push("bad", result.errors[0] ?? "PSID row not saved.");
      return;
    }
    setForm(emptyForm());
    setAdding(false);
    push("good", form.id ? "PSID row updated." : "PSID row saved.");
  }

  if (!client || !ledger) {
    return (
      <NeedClient
        title="Select a client"
        body="PSID numbers are created on PRA IRIS. This page only keeps the register."
      />
    );
  }

  const knownBanks = banks.map((row) => row.bankName).filter(Boolean);
  const bankOptions = Array.from(new Set([...knownBanks, form.bank].filter(Boolean)));

  return (
    <div className="stack">
      <PageHeader
        title="PSID register"
        description="Official slips stay on PRA IRIS. This page only keeps the register."
        actions={
          <button
            className="btn stamp"
            type="button"
            onClick={() => {
              setForm(emptyForm());
              setAdding(true);
            }}
          >
            Add PSID
          </button>
        }
      />

      <PsidGap ledger={ledger} />

      {ledger.psidMismatch ? (
        <Notice tone="bad">
          {psidCoverNote({ netPayable: ledger.netPayable, psidPaid: ledger.psidPaid })} Net{" "}
          {pkr(ledger.netPayable)} vs paid + claimed {pkr(ledger.psidPaid)}.
        </Notice>
      ) : null}

      {errors.length ? (
        <div className="alert bad">
          {errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      ) : null}

      {adding || form.id ? (
      <Panel title={form.id ? "Edit PSID" : "Add PSID"}>
        <form className="form-grid" onSubmit={(event) => void save(event)}>
          <TextInput
            label="Amount"
            value={form.amount}
            hint={ledger.psidGap > 0 ? `Net still unpaid: ${pkr(ledger.psidGap)}` : undefined}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
          <TextInput
            label="Paid amount"
            value={form.paidAmount}
            hint="Leave blank to use the full amount when status is paid or claimed."
            onChange={(event) => setForm({ ...form, paidAmount: event.target.value })}
          />
          <TextInput label="Head" value={form.head} onChange={(event) => setForm({ ...form, head: event.target.value })} />
          <TextInput
            label="PSID"
            className="mono"
            value={form.psid}
            onChange={(event) => setForm({ ...form, psid: event.target.value })}
          />
          <TextInput
            label="CPR"
            className="mono"
            value={form.cpr}
            onChange={(event) => setForm({ ...form, cpr: event.target.value })}
          />
          {banks.length ? (
            <SelectField
              label="Bank / ADC"
              value={form.bank}
              onChange={(event) => setForm({ ...form, bank: event.target.value })}
            >
              <option value="">Select a bank</option>
              {bankOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </SelectField>
          ) : (
            <TextInput
              label="Bank / ADC"
              value={form.bank}
              onChange={(event) => setForm({ ...form, bank: event.target.value })}
            />
          )}
          {banks.length ? (
            <TextInput
              label="Bank (other)"
              value={knownBanks.includes(form.bank) ? "" : form.bank}
              onChange={(event) => setForm({ ...form, bank: event.target.value })}
              hint="Free-text fallback if the bank is not on this file."
            />
          ) : null}
          <TextInput
            label="Due on"
            type="date"
            value={form.dueOn}
            onChange={(event) => setForm({ ...form, dueOn: event.target.value })}
          />
          <TextInput
            label="Paid on"
            type="date"
            value={form.paidOn}
            onChange={(event) => setForm({ ...form, paidOn: event.target.value })}
          />
          <SelectField
            label="Status"
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value as PsidStatus })}
          >
            <option value="planned">Planned</option>
            <option value="generated">Generated on IRIS</option>
            <option value="paid">Paid</option>
            <option value="claimed">Claimed in return</option>
          </SelectField>
          <AreaField
            label="Notes"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
          <div className="row">
            <button className="btn stamp" type="submit">
              {form.id ? "Update PSID row" : "Save PSID row"}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setForm(emptyForm());
                setAdding(false);
              }}
            >
              Cancel
            </button>
            {ledger.psidGap > 0 ? (
              <button
                className="btn ghost"
                type="button"
                onClick={() => setForm({ ...form, amount: String(ledger.psidGap) })}
              >
                Fill net gap
              </button>
            ) : null}
          </div>
        </form>
      </Panel>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>PSID / CPR</th>
              <th>Amount</th>
              <th>Due</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ledger.psids.map((row) => (
              <tr key={row.id}>
                <td className="mono">{row.period}</td>
                <td>
                  <div className="mono">{row.psid || "—"}</div>
                  <div className="muted mono">{row.cpr || "No CPR yet"}</div>
                  {row.bank ? <div className="muted">{row.bank}</div> : null}
                </td>
                <td>
                  {pkr(row.amount)}
                  {row.paidAmount != null && row.paidAmount !== row.amount ? (
                    <div className="muted">Paid {pkr(row.paidAmount)}</div>
                  ) : null}
                </td>
                <td className="mono">{row.dueOn || "—"}</td>
                <td>
                  <Badge tone={row.status}>{row.status}</Badge>
                </td>
                <td>
                  <button className="btn ghost" type="button" onClick={() => { loadRow(row); setAdding(true); }}>
                    Edit
                  </button>
                  <button className="btn ghost" type="button" onClick={() => setPendingRemove(row.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {ledger.psids.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No PSID rows for {period} yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Confirm
        open={Boolean(pendingRemove)}
        danger
        title="Remove this PSID row?"
        body="The register only. Official 1Bill slips stay on IRIS."
        confirmLabel="Remove row"
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          if (!pendingRemove) return;
          void removePsid(pendingRemove).then(() => {
            if (form.id === pendingRemove) {
              setForm(emptyForm());
              setAdding(false);
            }
            setPendingRemove(null);
            push("info", "PSID row removed.");
          });
        }}
      />
    </div>
  );
}
