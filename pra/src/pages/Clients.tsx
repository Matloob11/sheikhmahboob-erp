import { useMemo, useState, type FormEvent } from "react";
import { Badge } from "../components/Badge";
import { Confirm } from "../components/Confirm";
import { PageHeader } from "../components/PageHeader";
import { Tabs } from "../components/Tabs";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import { masterShowsForm, resolveMasterPane } from "../domain/masterPane";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";
import { db } from "../db";
import { type BankDraft } from "../domain/banks";
import {
  clientFileCounts,
  emptyClientDraft,
  mergeClientFiles,
  removeClientFile,
  saveClient,
  type ClientDraft,
} from "../domain/clients";
import { type PlaceDraft } from "../domain/places";
import { type PosDeviceDraft } from "../domain/posDevices";
import { saveBank } from "../domain/banks";
import { savePlace } from "../domain/places";
import { savePosDevice } from "../domain/posDevices";
import {
  buildWorkQueue,
  filterWorkQueue,
  type ClientWorkRow,
} from "../domain/today";
import { useLive, useLiveState } from "../hooks/useLive";
import { exportBackup } from "../lib/backup";
import { environmentLabel } from "../lib/statusLabel";
import { PRA_SANDBOX_TOKEN, type ClientBank, type ClientPlace, type ClientPosDevice, type Invoice, type PsidRecord, type ReturnPeriod } from "../types";
import { ClientBanksTab } from "./clients/ClientBanksTab";
import { ClientPlacesTab } from "./clients/ClientPlacesTab";
import { ClientPosTab } from "./clients/ClientPosTab";
import { ClientProfileTab } from "./clients/ClientProfileTab";
import { ClientsList } from "./clients/ClientsList";
import { blankBank, blankPlace, blankPos, draftFromClient, PAGE_SIZE } from "./clients/helpers";

export function ClientsPage() {
  const { clients, client: openFile, chooseClient, period } = useDesk();
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
  const listKey = `${query}|${showArchived}|${period}`;
  const [paging, setPaging] = useState({ key: listKey, page: 0 });
  const page = paging.key === listKey ? paging.page : 0;
  const setPage = (next: number) => setPaging({ key: listKey, page: next });

  const openState = useLiveState(
    () => db.invoices.where("status").anyOf("draft", "validated", "failed", "unknown").toArray(),
    [] as Invoice[],
    [],
  );
  const psidState = useLiveState(
    () => db.psids.where("period").equals(period).toArray(),
    [] as PsidRecord[],
    [period],
  );
  const returnState = useLiveState(
    () => db.returns.where("period").equals(period).toArray(),
    [] as ReturnPeriod[],
    [period],
  );
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

  const queue = useMemo(
    () =>
      buildWorkQueue({
        clients,
        openInvoices: openState.data,
        psids: psidState.data,
        returns: returnState.data,
        period,
        includeArchived: showArchived,
      }),
    [clients, openState.data, psidState.data, returnState.data, period, showArchived],
  );
  const shown = useMemo(
    () => filterWorkQueue(queue, { stage: "all", text: query }),
    [queue, query],
  );
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const visible = shown.map((row) => row.client);
  const pane = resolveMasterPane(
    visible.map((row) => row.id),
    creating ? null : editing,
    creating,
  );
  const showForm = masterShowsForm(pane);

  const leaveGuard = useUnsavedGuard(dirty);

  const related = pending ? pending.invoices + pending.purchases + pending.psids : 0;

  function openWorkRow(row: ClientWorkRow) {
    editClient(row.client.id);
  }

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
        <ClientsList
          period={period}
          query={query}
          shown={shown}
          rows={rows}
          openFileId={openFile?.id}
          pageCount={pageCount}
          current={current}
          setPage={setPage}
          onOpenRow={openWorkRow}
          onStartNew={startNew}
        />
      ) : (
        <div className="panel stack">
          <header className="panel-head">
            <h3>{editing ? form.businessName || "Edit client" : "New client"}</h3>
            {editing ? <Badge tone={form.environment}>{environmentLabel(form.environment)}</Badge> : null}
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
            <ClientProfileTab
              form={form}
              editing={editing}
              creating={creating}
              errors={errors}
              clients={clients}
              mergeInto={mergeInto}
              set={set}
              setDirty={setDirty}
              setCreating={setCreating}
              setMergeInto={setMergeInto}
              setMergeOpen={setMergeOpen}
              onSave={save}
              onAskRemove={askRemove}
              onChooseClient={chooseClient}
              onPrefillSandbox={() => {
                setForm({ ...emptyClientDraft, posToken: PRA_SANDBOX_TOKEN, posId: "100000" });
                setDirty(true);
                setErrors([]);
              }}
            />
          )}

          {editing && tab === "places" ? (
            <ClientPlacesTab
              places={places}
              placeForm={placeForm}
              editingPlace={editingPlace}
              placeErrors={placeErrors}
              setPlaceForm={setPlaceForm}
              setEditingPlace={setEditingPlace}
              setPlaceErrors={setPlaceErrors}
              onSavePlace={onSavePlace}
              onRemoved={() => push("info", "Removed place.")}
            />
          ) : null}

          {editing && tab === "banks" ? (
            <ClientBanksTab
              banks={banks}
              bankForm={bankForm}
              editingBank={editingBank}
              bankErrors={bankErrors}
              setBankForm={setBankForm}
              setEditingBank={setEditingBank}
              setBankErrors={setBankErrors}
              onSaveBank={onSaveBank}
              onRemoved={() => push("info", "Removed bank.")}
            />
          ) : null}

          {editing && tab === "pos" ? (
            <ClientPosTab
              form={form}
              places={places}
              devices={devices}
              posForm={posForm}
              editingPos={editingPos}
              posErrors={posErrors}
              setForm={setForm}
              setPosForm={setPosForm}
              setEditingPos={setEditingPos}
              setPosErrors={setPosErrors}
              onSavePos={onSavePos}
              onActivated={() => push("good", "This POS is now active on the file.")}
              onRemoved={() => push("info", "Removed POS device.")}
            />
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
