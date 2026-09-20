import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Confirm } from "../components/Confirm";
import { EmptyState } from "../components/EmptyState";
import { AreaField, SelectField, TextInput } from "../components/Field";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { Tabs } from "../components/Tabs";
import { PhoneLinks } from "../components/PhoneLinks";
import { TokenField } from "../components/TokenField";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import { emptyListCopy, masterShowsForm, resolveMasterPane } from "../domain/masterPane";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";
import { db } from "../db";
import { removeBank, saveBank, type BankDraft } from "../domain/banks";
import {
  clientFileCounts,
  emptyClientDraft,
  hasClientRegistration,
  registrationDisplay,
  mergeClientFiles,
  removeClientFile,
  saveClient,
  type ClientDraft,
} from "../domain/clients";
import { sectionPath } from "../domain/nav";
import { removePlace, savePlace, type PlaceDraft } from "../domain/places";
import { activatePosDevice, removePosDevice, savePosDevice, type PosDeviceDraft } from "../domain/posDevices";
import { useLive } from "../hooks/useLive";
import { exportBackup } from "../lib/backup";
import {
  PERSON_TYPES,
  PRA_SANDBOX_TOKEN,
  SECTORS,
  type Client,
  type ClientBank,
  type ClientPlace,
  type ClientPosDevice,
  type Environment,
  type PersonType,
} from "../types";

function fileGaps(row: Client): string[] {
  const gaps: string[] = [];
  if (!hasClientRegistration(row)) gaps.push("No PNTN");
  if (!row.posId.trim()) gaps.push("No POS");
  if (!row.posToken.trim()) gaps.push("No token");
  return gaps;
}

function draftFromClient(row: Client): ClientDraft {
  return {
    businessName: row.businessName,
    brandName: row.brandName,
    pntn: row.pntn,
    cnic: row.cnic,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    sector: row.sector,
    branchName: row.branchName,
    posId: row.posId,
    posToken: row.posToken,
    environment: row.environment,
    notes: row.notes,
    ntn: row.ntn ?? "",
    personName: row.personName ?? "",
    personType: row.personType ?? "",
    businessId: row.businessId ?? "",
    branchId: row.branchId ?? "",
    stStatus: row.stStatus ?? "",
    registeredOn: row.registeredOn ?? "",
    archived: row.archived === true,
    cnicAsRegistration: row.cnicAsRegistration === true,
  };
}

const blankPlace: PlaceDraft = {
  label: "",
  address: "",
  city: "",
  district: "",
  province: "Punjab",
  branchId: "",
  isPrimary: false,
};

const blankBank: BankDraft = {
  bankName: "",
  accountTitle: "",
  accountNo: "",
  iban: "",
  isPrimary: false,
  notes: "",
};

const blankPos: PosDeviceDraft = { posId: "", label: "", environment: "sandbox" };

export function ClientsPage() {
  const { clients, client: openFile, chooseClient } = useDesk();
  const { push } = useNotice();
  const [form, setForm] = useState<ClientDraft>(emptyClientDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("profile");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<{
    id: string;
    name: string;
    invoices: number;
    purchases: number;
    psids: number;
  } | null>(null);
  const [placeForm, setPlaceForm] = useState<PlaceDraft>(blankPlace);
  const [editingPlace, setEditingPlace] = useState<string | null>(null);
  const [placeErrors, setPlaceErrors] = useState<string[]>([]);
  const [bankForm, setBankForm] = useState<BankDraft>(blankBank);
  const [editingBank, setEditingBank] = useState<string | null>(null);
  const [bankErrors, setBankErrors] = useState<string[]>([]);
  const [mergeInto, setMergeInto] = useState("");
  const [posForm, setPosForm] = useState<PosDeviceDraft>(blankPos);
  const [editingPos, setEditingPos] = useState<string | null>(null);
  const [posErrors, setPosErrors] = useState<string[]>([]);

  const places = useLive(
    () => (editing ? db.clientPlaces.where("clientId").equals(editing).toArray() : Promise.resolve([] as ClientPlace[])),
    [] as ClientPlace[],
    [editing],
  );
  const banks = useLive(
    () => (editing ? db.clientBanks.where("clientId").equals(editing).toArray() : Promise.resolve([] as ClientBank[])),
    [] as ClientBank[],
    [editing],
  );
  const devices = useLive(
    () =>
      editing ? db.clientPosDevices.where("clientId").equals(editing).toArray() : Promise.resolve([] as ClientPosDevice[]),
    [] as ClientPosDevice[],
    [editing],
  );

  function set<K extends keyof ClientDraft>(key: K, value: ClientDraft[K]) {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function closePane() {
    setCreating(false);
    setEditing(null);
    setForm(emptyClientDraft);
    setTab("profile");
    setErrors([]);
    setDirty(false);
    setPlaceForm(blankPlace);
    setEditingPlace(null);
    setBankForm(blankBank);
    setEditingBank(null);
    setPosForm(blankPos);
    setEditingPos(null);
  }

  function startNew() {
    closePane();
    setCreating(true);
  }

  function editClient(id: string) {
    const row = clients.find((item) => item.id === id);
    if (!row) return;
    setCreating(false);
    setEditing(row.id);
    setErrors([]);
    setTab("profile");
    setDirty(false);
    setForm(draftFromClient(row));
    setPlaceForm(blankPlace);
    setEditingPlace(null);
    setBankForm(blankBank);
    setEditingBank(null);
    setPosForm({ ...blankPos, environment: row.environment });
    setEditingPos(null);
    void chooseClient(row.id);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const result = await saveClient(form, editing ?? undefined);
    setErrors(result.errors);
    if (result.errors.length) return;
    setCreating(false);
    setDirty(false);
    setEditing(result.client.id);
    push("good", editing ? `Updated ${result.client.businessName}.` : `Added ${result.client.businessName}.`);
  }

  async function askRemove(id: string, name: string) {
    const counts = await clientFileCounts(id);
    setPending({ id, name, ...counts });
  }

  async function remove(cascade: boolean) {
    if (!pending) return;
    await removeClientFile(pending.id, cascade);
    if (editing === pending.id) closePane();
    push("info", cascade ? `Removed ${pending.name} and related records.` : `Removed ${pending.name}.`);
    setPending(null);
  }

  async function onSavePlace(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const result = await savePlace(editing, placeForm, editingPlace ?? undefined);
    setPlaceErrors(result.errors);
    if (result.errors.length) return;
    setEditingPlace(result.place.id);
    if (result.place.isPrimary) {
      setForm((current) => ({
        ...current,
        address: result.place.address,
        city: result.place.city,
        branchId: result.place.branchId,
        branchName: result.place.label,
      }));
    }
    push("good", `Saved place ${result.place.label}.`);
  }

  async function onSaveBank(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const result = await saveBank(editing, bankForm, editingBank ?? undefined);
    setBankErrors(result.errors);
    if (result.errors.length) return;
    setEditingBank(result.bank.id);
    push("good", `Saved bank ${result.bank.bankName}.`);
  }

  async function onSavePos(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const result = await savePosDevice(editing, posForm, editingPos ?? undefined);
    setPosErrors(result.errors);
    if (result.errors.length) return;
    setEditingPos(result.device.id);
    push("good", `Saved POS ${result.device.posId}.`);
  }

  const visible = clients.filter((row) => {
    if (!showArchived && row.archived) return false;
    const hay = `${row.businessName} ${row.pntn} ${row.ntn ?? ""} ${row.personName ?? ""} ${row.cnic} ${row.city}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });
  const pane = resolveMasterPane(
    visible.map((row) => row.id),
    creating ? null : editing,
    creating,
  );
  const showForm = masterShowsForm(pane);

  const leaveGuard = useUnsavedGuard(dirty);

  const related = pending ? pending.invoices + pending.purchases + pending.psids : 0;

  return (
    <div className="stack">
      {leaveGuard}
      <PageHeader
        title="Clients"
        actions={
          <>
            {showForm ? (
              <button className="btn ghost" type="button" onClick={closePane}>
                Back to clients
              </button>
            ) : (
              <>
                <input
                  placeholder="Search name or PNTN"
                  aria-label="Search clients"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <label className="row">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(event) => setShowArchived(event.target.checked)}
                  />
                  Show archived
                </label>
              </>
            )}
            {editing ? (
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  void exportBackup({ tokenMode: "strip", clientId: editing })
                    .then(() => push("info", "Client backup downloaded (tokens stripped)."))
                    .catch((error: unknown) => push("bad", error instanceof Error ? error.message : "Export failed."));
                }}
              >
                Export this file
              </button>
            ) : null}
            <button className="btn stamp" type="button" onClick={startNew}>
              New client
            </button>
          </>
        }
      />

      {!showForm ? (
        visible.length === 0 ? (
          <EmptyState
            title={emptyListCopy(Boolean(query.trim()), "clients")}
            body={
              query.trim()
                ? "Clear the search to see every file on this desk."
                : "Add a taxpayer file, or import a backup from Settings."
            }
            action={
              <button className="btn stamp" type="button" onClick={startNew}>
                New client
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Client files</caption>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>PNTN</th>
                  <th>City</th>
                  <th>Sector</th>
                  <th>POS</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const gaps = fileGaps(row);
                  const reg = registrationDisplay(row);
                  return (
                    <tr
                      key={row.id}
                      className={row.id === openFile?.id ? "is-open" : undefined}
                    >
                      <td>
                        <button className="link-btn" type="button" onClick={() => editClient(row.id)}>
                          {row.businessName}
                        </button>
                        {row.archived ? <div className="muted">Archived</div> : null}
                        {gaps.length ? (
                          <div className="row" style={{ marginTop: 6 }}>
                            {gaps.map((gap) => (
                              <span key={gap} className="badge">
                                {gap}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="mono">{reg || "—"}</td>
                      <td>{row.city || "—"}</td>
                      <td>{row.sector}</td>
                      <td className="mono">{row.posId || "—"}</td>
                      <td>
                        <button className="btn ghost" type="button" onClick={() => editClient(row.id)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="panel stack">
          <header className="panel-head">
            <h3>{editing ? form.businessName || "Edit client" : "New client"}</h3>
            {editing ? <Badge tone={form.environment}>{form.environment}</Badge> : null}
          </header>
          {editing ? (
            <Tabs
              tabs={[
                { id: "profile", label: "Profile" },
                { id: "places", label: "Places" },
                { id: "banks", label: "Banks" },
                { id: "pos", label: "POS" },
              ]}
              value={tab}
              onChange={setTab}
            />
          ) : null}

          {(tab === "profile" || !editing) && (
            <form className="stack" onSubmit={(event) => void save(event)}>
              {errors.length ? (
                <Notice tone="bad">
                  {errors.map((error) => (
                    <div key={error}>{error}</div>
                  ))}
                </Notice>
              ) : null}
              <div className="form-grid">
                <TextInput
                  label="Business name"
                  required
                  autoComplete="organization"
                  value={form.businessName}
                  onChange={(event) => set("businessName", event.target.value)}
                />
                <TextInput label="Brand" value={form.brandName} onChange={(event) => set("brandName", event.target.value)} />
                <TextInput
                  label="Person name"
                  autoComplete="name"
                  value={form.personName ?? ""}
                  onChange={(event) => set("personName", event.target.value)}
                />
                <SelectField
                  label="Person type"
                  value={form.personType ?? ""}
                  onChange={(event) => set("personType", event.target.value as PersonType)}
                >
                  {PERSON_TYPES.map((row) => (
                    <option key={row.value || "none"} value={row.value}>
                      {row.label}
                    </option>
                  ))}
                </SelectField>
                <TextInput
                  label="PNTN"
                  className="mono"
                  value={form.pntn}
                  onChange={(event) => set("pntn", event.target.value)}
                  placeholder="1234567-8"
                  spellCheck={false}
                  autoComplete="off"
                />
                <TextInput
                  label="CNIC"
                  className="mono"
                  value={form.cnic}
                  onChange={(event) => set("cnic", event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <div className="stack">
                  <TextInput
                    label="Phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(event) => set("phone", event.target.value)}
                  />
                  <PhoneLinks phone={form.phone} name={form.businessName} />
                </div>
                <TextInput
                  label="Email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={form.email}
                  onChange={(event) => set("email", event.target.value)}
                />
                <TextInput label="City" autoComplete="address-level2" value={form.city} onChange={(event) => set("city", event.target.value)} />
                <SelectField label="Sector" value={form.sector} onChange={(event) => set("sector", event.target.value)}>
                  {SECTORS.map((sector) => (
                    <option key={sector}>{sector}</option>
                  ))}
                </SelectField>
                <TextInput
                  label="Branch"
                  value={form.branchName}
                  onChange={(event) => set("branchName", event.target.value)}
                />
                <TextInput
                  label="Address"
                  autoComplete="street-address"
                  value={form.address}
                  onChange={(event) => set("address", event.target.value)}
                />
              </div>
              <label className="row">
                <input
                  type="checkbox"
                  checked={form.cnicAsRegistration === true}
                  onChange={(event) => set("cnicAsRegistration", event.target.checked)}
                />
                CNIC is the registration number
              </label>
              <div className="form-block">
                <h4>eIMS connection</h4>
                <div className="form-grid">
                  <TextInput
                    label="POS ID"
                    className="mono"
                    value={form.posId}
                    onChange={(event) => set("posId", event.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <SelectField
                    label="Environment"
                    value={form.environment}
                    onChange={(event) => set("environment", event.target.value as Environment)}
                  >
                    <option value="sandbox">Sandbox</option>
                    <option value="production">Production</option>
                  </SelectField>
                </div>
                <TokenField
                  label="eIMS token"
                  value={form.posToken}
                  onChange={(value) => {
                    setDirty(true);
                    set("posToken", value);
                  }}
                  placeholder="Bearer token from PRA IRIS"
                />
              </div>
              <details className="more-fields">
                <summary>IRIS and registration extras</summary>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <TextInput
                    label="FBR NTN"
                    className="mono"
                    value={form.ntn ?? ""}
                    onChange={(event) => set("ntn", event.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <TextInput
                    label="ST status"
                    value={form.stStatus ?? ""}
                    onChange={(event) => set("stStatus", event.target.value)}
                  />
                  <TextInput
                    label="Registered on"
                    value={form.registeredOn ?? ""}
                    onChange={(event) => set("registeredOn", event.target.value)}
                    placeholder="YYYY-MM-DD"
                  />
                  <TextInput
                    label="IRIS business id"
                    className="mono"
                    value={form.businessId ?? ""}
                    onChange={(event) => set("businessId", event.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <TextInput
                    label="IRIS branch id"
                    className="mono"
                    value={form.branchId ?? ""}
                    onChange={(event) => set("branchId", event.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              </details>
              <AreaField label="Notes" value={form.notes} onChange={(event) => set("notes", event.target.value)} />
              <div className="row">
                <button className="btn stamp" type="submit">
                  {editing ? "Update client" : "Add client"}
                </button>
                {creating ? (
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      setForm({ ...emptyClientDraft, posToken: PRA_SANDBOX_TOKEN, posId: "100000" });
                      setDirty(true);
                      setErrors([]);
                    }}
                  >
                    Prefill sandbox
                  </button>
                ) : null}
                {editing ? (
                  <>
                    <Link className="btn ghost" to={sectionPath("/invoices/new")} onClick={() => void chooseClient(editing)}>
                      New invoice
                    </Link>
                    <label className="row">
                      <input
                        type="checkbox"
                        checked={form.archived === true}
                        onChange={(event) => set("archived", event.target.checked)}
                      />
                      Archive
                    </label>
                    <button className="btn ghost" type="button" onClick={() => void askRemove(editing, form.businessName)}>
                      Remove
                    </button>
                    <label className="field">
                      <span>Merge this file into</span>
                      <select value={mergeInto} onChange={(event) => setMergeInto(event.target.value)}>
                        <option value="">Select target</option>
                        {clients
                          .filter((row) => row.id !== editing)
                          .map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.businessName}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={!mergeInto}
                      onClick={() => setMergeOpen(true)}
                    >
                      Merge into target
                    </button>
                    {creating ? (
                      <button className="btn ghost" type="button" onClick={() => setCreating(false)}>
                        Cancel
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button className="btn ghost" type="button" onClick={() => setCreating(false)}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}

          {editing && tab === "places" ? (
            <div className="stack">
              <div className="client-list" style={{ maxHeight: "none" }}>
                {places.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={row.id === editingPlace ? "client-item on" : "client-item"}
                    onClick={() => {
                      setEditingPlace(row.id);
                      setPlaceErrors([]);
                      setPlaceForm({
                        label: row.label,
                        address: row.address,
                        city: row.city,
                        district: row.district,
                        province: row.province,
                        branchId: row.branchId,
                        isPrimary: row.isPrimary,
                      });
                    }}
                  >
                    <strong>{row.label}</strong>
                    <span>
                      {row.city || row.address || "No address"}
                      {row.isPrimary ? " · Primary" : ""}
                    </span>
                  </button>
                ))}
                {places.length === 0 ? <p className="muted">No extra places yet. Primary address stays on Profile.</p> : null}
              </div>
              <form className="stack" onSubmit={(event) => void onSavePlace(event)}>
                {placeErrors.length ? (
                  <Notice tone="bad">
                    {placeErrors.map((error) => (
                      <div key={error}>{error}</div>
                    ))}
                  </Notice>
                ) : null}
                <div className="form-grid">
                  <TextInput
                    label="Label"
                    required
                    value={placeForm.label}
                    onChange={(event) => setPlaceForm((current) => ({ ...current, label: event.target.value }))}
                  />
                  <TextInput
                    label="City"
                    value={placeForm.city}
                    onChange={(event) => setPlaceForm((current) => ({ ...current, city: event.target.value }))}
                  />
                  <TextInput
                    label="District"
                    value={placeForm.district}
                    onChange={(event) => setPlaceForm((current) => ({ ...current, district: event.target.value }))}
                  />
                  <TextInput
                    label="Province"
                    value={placeForm.province}
                    onChange={(event) => setPlaceForm((current) => ({ ...current, province: event.target.value }))}
                  />
                  <TextInput
                    label="Address"
                    value={placeForm.address}
                    onChange={(event) => setPlaceForm((current) => ({ ...current, address: event.target.value }))}
                  />
                  <TextInput
                    label="IRIS branch id"
                    className="mono"
                    value={placeForm.branchId}
                    onChange={(event) => setPlaceForm((current) => ({ ...current, branchId: event.target.value }))}
                  />
                </div>
                <label className="row">
                  <input
                    type="checkbox"
                    checked={placeForm.isPrimary}
                    onChange={(event) => setPlaceForm((current) => ({ ...current, isPrimary: event.target.checked }))}
                  />
                  Primary place (copies onto the file)
                </label>
                <div className="row">
                  <button className="btn stamp" type="submit">
                    {editingPlace ? "Update place" : "Save place"}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      setPlaceForm(blankPlace);
                      setEditingPlace(null);
                      setPlaceErrors([]);
                    }}
                  >
                    New
                  </button>
                  {editingPlace ? (
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => {
                        void removePlace(editingPlace).then(() => {
                          setPlaceForm(blankPlace);
                          setEditingPlace(null);
                          push("info", "Removed place.");
                        });
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </form>
            </div>
          ) : null}

          {editing && tab === "banks" ? (
            <div className="stack">
              <div className="client-list" style={{ maxHeight: "none" }}>
                {banks.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={row.id === editingBank ? "client-item on" : "client-item"}
                    onClick={() => {
                      setEditingBank(row.id);
                      setBankErrors([]);
                      setBankForm({
                        bankName: row.bankName,
                        accountTitle: row.accountTitle,
                        accountNo: row.accountNo,
                        iban: row.iban,
                        isPrimary: row.isPrimary,
                        notes: row.notes,
                      });
                    }}
                  >
                    <strong>{row.bankName}</strong>
                    <span>
                      {row.accountTitle || row.iban || row.accountNo || "No account"}
                      {row.isPrimary ? " · Primary" : ""}
                    </span>
                  </button>
                ))}
                {banks.length === 0 ? <p className="muted">No bank accounts on this file.</p> : null}
              </div>
              <form className="stack" onSubmit={(event) => void onSaveBank(event)}>
                {bankErrors.length ? (
                  <Notice tone="bad">
                    {bankErrors.map((error) => (
                      <div key={error}>{error}</div>
                    ))}
                  </Notice>
                ) : null}
                <div className="form-grid">
                  <TextInput
                    label="Bank"
                    required
                    value={bankForm.bankName}
                    onChange={(event) => setBankForm((current) => ({ ...current, bankName: event.target.value }))}
                  />
                  <TextInput
                    label="Account title"
                    value={bankForm.accountTitle}
                    onChange={(event) => setBankForm((current) => ({ ...current, accountTitle: event.target.value }))}
                  />
                  <TextInput
                    label="Account no"
                    className="mono"
                    value={bankForm.accountNo}
                    onChange={(event) => setBankForm((current) => ({ ...current, accountNo: event.target.value }))}
                  />
                  <TextInput
                    label="IBAN"
                    className="mono"
                    value={bankForm.iban}
                    onChange={(event) => setBankForm((current) => ({ ...current, iban: event.target.value }))}
                  />
                </div>
                <label className="row">
                  <input
                    type="checkbox"
                    checked={bankForm.isPrimary}
                    onChange={(event) => setBankForm((current) => ({ ...current, isPrimary: event.target.checked }))}
                  />
                  Primary account
                </label>
                <AreaField
                  label="Notes"
                  value={bankForm.notes}
                  onChange={(event) => setBankForm((current) => ({ ...current, notes: event.target.value }))}
                />
                <div className="row">
                  <button className="btn stamp" type="submit">
                    {editingBank ? "Update bank" : "Save bank"}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      setBankForm(blankBank);
                      setEditingBank(null);
                      setBankErrors([]);
                    }}
                  >
                    New
                  </button>
                  {editingBank ? (
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => {
                        void removeBank(editingBank).then(() => {
                          setBankForm(blankBank);
                          setEditingBank(null);
                          push("info", "Removed bank.");
                        });
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </form>
            </div>
          ) : null}

          {editing && tab === "pos" ? (
            <div className="stack">
              <p className="muted" style={{ margin: 0 }}>
                Extra POS rows store id, label and place only. The active token stays on this file.
              </p>
              <div className="client-list" style={{ maxHeight: "none" }}>
                {devices.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={row.id === editingPos ? "client-item on" : "client-item"}
                    onClick={() => {
                      setEditingPos(row.id);
                      setPosErrors([]);
                      setPosForm({
                        posId: row.posId,
                        label: row.label,
                        environment: row.environment,
                        placeId: row.placeId,
                      });
                    }}
                  >
                    <strong>{row.label || row.posId}</strong>
                    <span className="mono">
                      {row.posId} · {row.environment}
                      {row.posId === form.posId ? " · Active" : ""}
                    </span>
                  </button>
                ))}
                {devices.length === 0 ? <p className="muted">No extra POS devices. Active POS ID stays on Profile.</p> : null}
              </div>
              <form className="stack" onSubmit={(event) => void onSavePos(event)}>
                {posErrors.length ? (
                  <Notice tone="bad">
                    {posErrors.map((error) => (
                      <div key={error}>{error}</div>
                    ))}
                  </Notice>
                ) : null}
                <div className="form-grid">
                  <TextInput
                    label="POS ID"
                    className="mono"
                    required
                    value={posForm.posId}
                    onChange={(event) => setPosForm((current) => ({ ...current, posId: event.target.value }))}
                  />
                  <TextInput
                    label="Label"
                    value={posForm.label}
                    onChange={(event) => setPosForm((current) => ({ ...current, label: event.target.value }))}
                  />
                  <SelectField
                    label="Environment"
                    value={posForm.environment}
                    onChange={(event) =>
                      setPosForm((current) => ({ ...current, environment: event.target.value as Environment }))
                    }
                  >
                    <option value="sandbox">Sandbox</option>
                    <option value="production">Production</option>
                  </SelectField>
                  <SelectField
                    label="Place"
                    value={posForm.placeId ?? ""}
                    onChange={(event) => setPosForm((current) => ({ ...current, placeId: event.target.value || undefined }))}
                  >
                    <option value="">None</option>
                    {places.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.label}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="row">
                  <button className="btn stamp" type="submit">
                    {editingPos ? "Update POS" : "Save POS"}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      setPosForm({ ...blankPos, environment: form.environment });
                      setEditingPos(null);
                      setPosErrors([]);
                    }}
                  >
                    New
                  </button>
                  {editingPos ? (
                    <>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => {
                          void activatePosDevice(editingPos).then((result) => {
                            if (result.errors.length) {
                              setPosErrors(result.errors);
                              return;
                            }
                            const device = devices.find((row) => row.id === editingPos);
                            if (device) {
                              setForm((current) => ({
                                ...current,
                                posId: device.posId,
                                environment: device.environment,
                              }));
                            }
                            push("good", "This POS is now active on the file.");
                          });
                        }}
                      >
                        Use this POS
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => {
                          void removePosDevice(editingPos).then(() => {
                            setPosForm({ ...blankPos, environment: form.environment });
                            setEditingPos(null);
                            push("info", "Removed POS device.");
                          });
                        }}
                      >
                        Remove
                      </button>
                    </>
                  ) : null}
                </div>
              </form>
            </div>
          ) : null}
        </div>
      )}

      <Confirm
        open={Boolean(pending)}
        title={pending ? `Remove ${pending.name}?` : "Remove client"}
        body={
          pending ? (
            <div>
              <p>
                This client holds {pending.invoices} invoice{pending.invoices === 1 ? "" : "s"}, {pending.purchases}{" "}
                purchase{pending.purchases === 1 ? "" : "s"}, and {pending.psids} PSID row
                {pending.psids === 1 ? "" : "s"}.
              </p>
              <p>
                {related
                  ? "Remove the client only, or delete the related records with it."
                  : "There are no related records."}
              </p>
            </div>
          ) : (
            ""
          )
        }
        confirmLabel="Remove client only"
        onConfirm={() => void remove(false)}
        extraLabel={related ? "Delete records too" : undefined}
        extraDanger
        onExtra={related ? () => void remove(true) : undefined}
        onCancel={() => setPending(null)}
      />
      <Confirm
        open={mergeOpen}
        danger
        title="Merge this file?"
        body="Invoices, purchases and PSIDs move to the target. This file is removed. This cannot be undone from here."
        confirmLabel="Merge files"
        onCancel={() => setMergeOpen(false)}
        onConfirm={() => {
          if (!editing || !mergeInto) return;
          void mergeClientFiles(editing, mergeInto).then((result) => {
            if (result.errors.length) {
              setErrors(result.errors);
              setMergeOpen(false);
              return;
            }
            setMergeInto("");
            setMergeOpen(false);
            setCreating(false);
            setEditing(mergeInto);
            void chooseClient(mergeInto);
            push("good", "Files merged. The source file is gone.");
          });
        }}
      />
    </div>
  );
}
