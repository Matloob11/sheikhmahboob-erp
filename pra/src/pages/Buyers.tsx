import { useState, type FormEvent } from "react";
import { Confirm } from "../components/Confirm";
import { EmptyState } from "../components/EmptyState";
import { AreaField, SelectField, TextInput } from "../components/Field";
import { NeedClient } from "../components/NeedClient";
import { PhoneLinks } from "../components/PhoneLinks";
import { Skeleton } from "../components/Skeleton";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import { removeBuyer, saveBuyer, searchBuyers, type BuyerDraft } from "../domain/buyers";
import { emptyListCopy, masterShowsForm, resolveMasterPane } from "../domain/masterPane";
import { stashTrash } from "../domain/trash";
import { db } from "../db";
import { useLiveState } from "../hooks/useLive";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";
import { BUYER_TYPES, type Buyer, type BuyerType } from "../types";

const blank: BuyerDraft = {
  name: "",
  pntn: "",
  cnic: "",
  phone: "",
  notes: "",
  address: "",
  district: "",
  email: "",
  buyerType: "",
};

export function BuyersPage() {
  const { client } = useDesk();
  const { push } = useNotice();
  const buyersState = useLiveState(
    () => (client ? db.buyers.where("clientId").equals(client.id).toArray() : Promise.resolve([] as Buyer[])),
    [] as Buyer[],
    [client?.id],
  );
  const buyers = buyersState.data;
  const [form, setForm] = useState<BuyerDraft>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<Buyer | null>(null);
  const [dirty, setDirty] = useState(false);

  const visible = searchBuyers(buyers, query).sort((a, b) => a.name.localeCompare(b.name));
  const pane = resolveMasterPane(visible.map((row) => row.id), creating ? null : editing, creating);
  const showForm = masterShowsForm(pane);

  const leaveGuard = useUnsavedGuard(dirty);

  if (!client) {
    return (
      <>
        {leaveGuard}
        <NeedClient title="Select a client" body="Buyers belong to one taxpayer file." />
      </>
    );
  }
  if (!buyersState.ready) {
    return (
      <>
        {leaveGuard}
        <Skeleton lines={5} />
      </>
    );
  }

  function closePane() {
    setCreating(false);
    setEditing(null);
    setErrors([]);
    setDirty(false);
    setForm(blank);
  }

  function edit(row: Buyer) {
    setCreating(false);
    setEditing(row.id);
    setErrors([]);
    setDirty(false);
    setForm({
      name: row.name,
      pntn: row.pntn,
      cnic: row.cnic,
      phone: row.phone,
      notes: row.notes,
      address: row.address ?? "",
      district: row.district ?? "",
      email: row.email ?? "",
      buyerType: row.buyerType ?? "",
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    const result = await saveBuyer(client.id, form, editing ?? undefined);
    setErrors(result.errors);
    if (result.errors.length) return;
    setCreating(false);
    setDirty(false);
    setEditing(result.buyer.id);
    push("good", editing ? `Updated ${result.buyer.name}.` : `Saved ${result.buyer.name}.`);
  }

  return (
    <div className="stack">
      {leaveGuard}
      <PageHeader
        title="Buyers"
        actions={
          <>
            {showForm ? (
              <button className="btn ghost" type="button" onClick={closePane}>
                Back to buyers
              </button>
            ) : (
              <input
                placeholder="Search buyers"
                aria-label="Search buyers"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
            <button
              className="btn stamp"
              type="button"
              onClick={() => {
                closePane();
                setCreating(true);
              }}
            >
              New buyer
            </button>
          </>
        }
      />

      {!showForm ? (
        visible.length === 0 ? (
          <EmptyState
            title={emptyListCopy(Boolean(query.trim()), "buyers")}
            body="Save a buyer to reuse name, PNTN and phone on invoices."
            action={
              <button
                className="btn stamp"
                type="button"
                onClick={() => {
                  closePane();
                  setCreating(true);
                }}
              >
                New buyer
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Buyers</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>PNTN</th>
                  <th>Phone</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button className="link-btn" type="button" onClick={() => edit(row)}>
                        {row.name}
                      </button>
                    </td>
                    <td className="mono">{row.pntn || "—"}</td>
                    <td>{row.phone || row.cnic || "—"}</td>
                    <td>
                      <button className="btn ghost" type="button" onClick={() => edit(row)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <form className="panel stack" onSubmit={(event) => void save(event)}>
          <header className="panel-head">
            <h3>{editing ? form.name || "Edit buyer" : "New buyer"}</h3>
          </header>
          {errors.length ? (
            <Notice tone="bad">
              {errors.map((error) => (
                <div key={error}>{error}</div>
              ))}
            </Notice>
          ) : null}
          <div className="form-grid">
            <TextInput
              label="Name"
              required
              autoComplete="name"
              value={form.name}
              onChange={(event) => {
                setDirty(true);
                setForm((current) => ({ ...current, name: event.target.value }));
              }}
            />
            <TextInput
              label="PNTN"
              className="mono"
              value={form.pntn}
              placeholder="1234567-8"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                setDirty(true);
                setForm((current) => ({ ...current, pntn: event.target.value }));
              }}
            />
            <TextInput
              label="CNIC"
              className="mono"
              value={form.cnic}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                setDirty(true);
                setForm((current) => ({ ...current, cnic: event.target.value }));
              }}
            />
            <div className="stack">
              <TextInput
                label="Phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(event) => {
                  setDirty(true);
                  setForm((current) => ({ ...current, phone: event.target.value }));
                }}
              />
              <PhoneLinks phone={form.phone} name={form.name} />
            </div>
            <TextInput
              label="Email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              value={form.email ?? ""}
              onChange={(event) => {
                setDirty(true);
                setForm((current) => ({ ...current, email: event.target.value }));
              }}
            />
            <TextInput
              label="Address"
              value={form.address ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
            />
            <TextInput
              label="District"
              value={form.district ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, district: event.target.value }))}
            />
            <SelectField
              label="Buyer type"
              value={form.buyerType ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, buyerType: event.target.value as BuyerType }))}
            >
              {BUYER_TYPES.map((row) => (
                <option key={row.value || "none"} value={row.value}>
                  {row.label}
                </option>
              ))}
            </SelectField>
          </div>
          <AreaField
            label="Notes"
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />
          <div className="row">
            <button className="btn stamp" type="submit">
              {editing ? "Update buyer" : "Save buyer"}
            </button>
            {editing ? (
              <button className="btn ghost" type="button" onClick={() => setPending(buyers.find((row) => row.id === editing) ?? null)}>
                Remove
              </button>
            ) : (
              <button className="btn ghost" type="button" onClick={closePane}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      <Confirm
        open={Boolean(pending)}
        danger
        title={pending ? `Remove ${pending.name}?` : "Remove buyer"}
        body="This buyer stays off the pick list. Posted invoices keep the copied header."
        confirmLabel="Remove buyer"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          stashTrash({ kind: "buyer", label: pending.name, restore: pending });
          void removeBuyer(pending.id).then(() => {
            if (editing === pending.id) {
              setForm(blank);
              setEditing(null);
            }
            push("info", `Removed ${pending.name}. Undo from the top banner for 30 minutes.`);
            setPending(null);
          });
        }}
      />
    </div>
  );
}
