import { useState, type FormEvent } from "react";
import { Confirm } from "../components/Confirm";
import { EmptyState } from "../components/EmptyState";
import { TextInput } from "../components/Field";
import { NeedClient } from "../components/NeedClient";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { Tabs } from "../components/Tabs";
import { useDesk } from "../context/DeskContext";
import { useNotice } from "../context/NoticeContext";
import { emptyListCopy, masterShowsForm, resolveMasterPane } from "../domain/masterPane";
import { searchCatalogItems, searchPctCodes } from "../domain/catalog";
import {
  addSectorDefaultItem,
  removeCatalogItem,
  removePctCode,
  saveCatalogItem,
  savePctCode,
  type ItemDraft,
  type PctDraft,
} from "../domain/items";
import { db } from "../db";
import { useLive } from "../hooks/useLive";
import { parseAmount } from "../lib/money";
import type { CatalogItem, PctCode } from "../types";

const blankItem: ItemDraft = {
  itemCode: "",
  itemName: "",
  pctCode: "98154000",
  taxRate: 16,
  unit: "Svc",
  defaultQty: 1,
  inactive: false,
};
const blankPct: PctDraft = { pctCode: "", name: "", taxRate: 16 };

export function ItemsPage() {
  const { client } = useDesk();
  const { push } = useNotice();
  const [tab, setTab] = useState("items");
  const items = useLive(
    () => (client ? db.items.where("clientId").equals(client.id).toArray() : Promise.resolve([] as CatalogItem[])),
    [] as CatalogItem[],
    [client?.id],
  );
  const rates = useLive(() => db.pctCodes.orderBy("name").toArray(), [] as PctCode[], []);
  const [itemForm, setItemForm] = useState<ItemDraft>(blankItem);
  const [pctForm, setPctForm] = useState<PctDraft>(blankPct);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [creatingItem, setCreatingItem] = useState(false);
  const [editingPct, setEditingPct] = useState<string | null>(null);
  const [creatingPct, setCreatingPct] = useState(false);
  const [query, setQuery] = useState("");
  const [itemErrors, setItemErrors] = useState<string[]>([]);
  const [pctErrors, setPctErrors] = useState<string[]>([]);
  const [pendingItem, setPendingItem] = useState<CatalogItem | null>(null);
  const [pendingPct, setPendingPct] = useState<PctCode | null>(null);

  const visibleItems = searchCatalogItems(items, query).sort((a, b) => a.itemName.localeCompare(b.itemName));
  const visibleRates = searchPctCodes(rates, query).sort((a, b) => a.name.localeCompare(b.name));
  const itemPane = resolveMasterPane(
    visibleItems.map((row) => row.id),
    creatingItem ? null : editingItem,
    creatingItem,
  );
  const pctPane = resolveMasterPane(
    visibleRates.map((row) => row.id),
    creatingPct ? null : editingPct,
    creatingPct,
  );
  const showItemForm = masterShowsForm(itemPane);
  const showPctForm = masterShowsForm(pctPane);

  function closeItemPane() {
    setCreatingItem(false);
    setEditingItem(null);
    setItemForm(blankItem);
    setItemErrors([]);
  }

  function openItem(row: CatalogItem) {
    setCreatingItem(false);
    setEditingItem(row.id);
    setItemErrors([]);
    setItemForm({
      itemCode: row.itemCode,
      itemName: row.itemName,
      pctCode: row.pctCode,
      taxRate: row.taxRate,
      unit: row.unit ?? "Svc",
      defaultQty: row.defaultQty ?? 1,
      inactive: row.inactive === true,
    });
  }

  function closePctPane() {
    setCreatingPct(false);
    setEditingPct(null);
    setPctForm(blankPct);
    setPctErrors([]);
  }

  if (!client) {
    return <NeedClient title="Select a client" body="Items attach to one taxpayer file. PCT rates are shared on the desk." />;
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    const result = await saveCatalogItem(client.id, itemForm, editingItem ?? undefined);
    setItemErrors(result.errors);
    if (result.errors.length) return;
    setCreatingItem(false);
    setEditingItem(result.item.id);
    push("good", editingItem ? `Updated ${result.item.itemName}.` : `Saved ${result.item.itemName}.`);
  }

  async function savePct(event: FormEvent) {
    event.preventDefault();
    const result = await savePctCode(pctForm, editingPct ?? undefined);
    setPctErrors(result.errors);
    if (result.errors.length) return;
    setCreatingPct(false);
    setEditingPct(result.rate.id);
    push("good", `Saved PCT ${result.rate.pctCode}.`);
  }

  return (
    <div className="stack">
      <PageHeader
        title="Items & PCT"
        actions={
          <input
            placeholder="Search items or PCT"
            aria-label="Search catalog"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        }
      />

      <Tabs
        tabs={[
          { id: "items", label: "Items" },
          { id: "pct", label: "PCT rates" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "items" ? (
        !showItemForm ? (
          visibleItems.length === 0 ? (
            <EmptyState
              title={emptyListCopy(Boolean(query.trim()), "items")}
              body="Save catalog lines so invoices can pick a name, PCT and rate."
              action={
                <button
                  className="btn stamp"
                  type="button"
                  onClick={() => {
                    closeItemPane();
                    setCreatingItem(true);
                  }}
                >
                  New item
                </button>
              }
            />
          ) : (
            <div className="stack">
              <div className="row">
                <button
                  className="btn stamp"
                  type="button"
                  onClick={() => {
                    closeItemPane();
                    setCreatingItem(true);
                  }}
                >
                  New item
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Items</caption>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Code</th>
                      <th>PCT</th>
                      <th>Rate</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <button className="link-btn" type="button" onClick={() => openItem(row)}>
                            {row.itemName}
                          </button>
                          {row.inactive ? <div className="muted">Inactive</div> : null}
                        </td>
                        <td className="mono">{row.itemCode}</td>
                        <td className="mono">{row.pctCode}</td>
                        <td>{row.taxRate}%</td>
                        <td>
                          <button className="btn ghost" type="button" onClick={() => openItem(row)}>
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : (
          <form className="panel stack" onSubmit={(event) => void saveItem(event)}>
            <header className="panel-head">
              <h3>{editingItem ? itemForm.itemName || "Edit item" : "New item"}</h3>
              <button className="btn ghost" type="button" onClick={closeItemPane}>
                Back to items
              </button>
            </header>
            {itemErrors.length ? (
              <Notice tone="bad">
                {itemErrors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </Notice>
            ) : null}
            <div className="form-grid">
              <TextInput
                label="Item code"
                className="mono"
                value={itemForm.itemCode}
                onChange={(event) => setItemForm((current) => ({ ...current, itemCode: event.target.value }))}
              />
              <TextInput
                label="Item name"
                value={itemForm.itemName}
                onChange={(event) => setItemForm((current) => ({ ...current, itemName: event.target.value }))}
              />
              <TextInput
                label="PCT / HS"
                className="mono"
                value={itemForm.pctCode}
                onChange={(event) => setItemForm((current) => ({ ...current, pctCode: event.target.value }))}
              />
              <TextInput
                label="Tax rate %"
                value={String(itemForm.taxRate)}
                onChange={(event) => setItemForm((current) => ({ ...current, taxRate: parseAmount(event.target.value) }))}
              />
              <TextInput
                label="Unit"
                value={itemForm.unit ?? ""}
                onChange={(event) => setItemForm((current) => ({ ...current, unit: event.target.value }))}
              />
              <TextInput
                label="Default qty"
                value={String(itemForm.defaultQty ?? 1)}
                onChange={(event) =>
                  setItemForm((current) => ({ ...current, defaultQty: parseAmount(event.target.value) }))
                }
              />
            </div>
            <label className="row">
              <input
                type="checkbox"
                checked={itemForm.inactive === true}
                onChange={(event) => setItemForm((current) => ({ ...current, inactive: event.target.checked }))}
              />
              Inactive
            </label>
            <div className="row">
              <button className="btn stamp" type="submit">
                {editingItem ? "Update item" : "Save item"}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  if (!client) return;
                  void addSectorDefaultItem(client.id, client.sector).then((result) => {
                    if (result.errors.length) {
                      setItemErrors(result.errors);
                      return;
                    }
                    setEditingItem(result.item.id);
                    setItemForm({
                      itemCode: result.item.itemCode,
                      itemName: result.item.itemName,
                      pctCode: result.item.pctCode,
                      taxRate: result.item.taxRate,
                      unit: result.item.unit ?? "Svc",
                      defaultQty: result.item.defaultQty ?? 1,
                      inactive: result.item.inactive === true,
                    });
                    push("good", `Added ${result.item.itemName} from ${client.sector}.`);
                  });
                }}
              >
                Add sector default
              </button>
              {editingItem ? (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setPendingItem(items.find((row) => row.id === editingItem) ?? null)}
                >
                  Remove
                </button>
              ) : (
                <button className="btn ghost" type="button" onClick={closeItemPane}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        )
      ) : !showPctForm ? (
        <div className="stack">
          <div className="row">
            <button
              className="btn stamp"
              type="button"
              onClick={() => {
                closePctPane();
                setCreatingPct(true);
              }}
            >
              New PCT
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">PCT rates</caption>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>PCT</th>
                  <th>Rate</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleRates.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button
                        className="link-btn"
                        type="button"
                        onClick={() => {
                          closePctPane();
                          setEditingPct(row.id);
                          setPctForm({ pctCode: row.pctCode, name: row.name, taxRate: row.taxRate });
                        }}
                      >
                        {row.name}
                      </button>
                      {row.seeded ? <div className="muted">Seeded</div> : null}
                    </td>
                    <td className="mono">{row.pctCode}</td>
                    <td>{row.taxRate}%</td>
                    <td>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => {
                          closePctPane();
                          setEditingPct(row.id);
                          setPctForm({ pctCode: row.pctCode, name: row.name, taxRate: row.taxRate });
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <form className="panel stack" onSubmit={(event) => void savePct(event)}>
            <header className="panel-head">
              <h3>{editingPct ? pctForm.name || "Edit PCT" : "New PCT"}</h3>
              <button className="btn ghost" type="button" onClick={closePctPane}>
                Back to rates
              </button>
            </header>
            {pctErrors.length ? (
              <Notice tone="bad">
                {pctErrors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </Notice>
            ) : null}
            <p className="muted" style={{ margin: 0 }}>
              Seeded rates follow the Punjab Second Schedule as a starting point. Change them if a client uses another heading.
            </p>
            <div className="form-grid">
              <TextInput
                label="PCT / HS"
                className="mono"
                value={pctForm.pctCode}
                onChange={(event) => setPctForm((current) => ({ ...current, pctCode: event.target.value }))}
              />
              <TextInput
                label="Tax rate %"
                value={String(pctForm.taxRate)}
                onChange={(event) => setPctForm((current) => ({ ...current, taxRate: parseAmount(event.target.value) }))}
              />
              <TextInput
                label="Description"
                value={pctForm.name}
                onChange={(event) => setPctForm((current) => ({ ...current, name: event.target.value }))}
              />
            </div>
            <div className="row">
              <button className="btn stamp" type="submit">
                {editingPct ? "Update PCT" : "Save PCT"}
              </button>
              {editingPct ? (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setPendingPct(rates.find((row) => row.id === editingPct) ?? null)}
                >
                  Remove
                </button>
              ) : (
                <button className="btn ghost" type="button" onClick={closePctPane}>
                  Cancel
                </button>
              )}
            </div>
        </form>
      )}

      <Confirm
        open={Boolean(pendingItem)}
        danger
        title={pendingItem ? `Remove ${pendingItem.itemName}?` : "Remove item"}
        body="Invoice lines already written keep their copied code and PCT."
        confirmLabel="Remove item"
        onCancel={() => setPendingItem(null)}
        onConfirm={() => {
          if (!pendingItem) return;
          void removeCatalogItem(pendingItem.id).then(() => {
            if (editingItem === pendingItem.id) {
              setItemForm(blankItem);
              setEditingItem(null);
            }
            push("info", `Removed ${pendingItem.itemName}.`);
            setPendingItem(null);
          });
        }}
      />
      <Confirm
        open={Boolean(pendingPct)}
        danger
        title={pendingPct ? `Remove PCT ${pendingPct.pctCode}?` : "Remove PCT"}
        body="Seeded Punjab rates cannot be deleted. They can be edited."
        confirmLabel="Remove PCT"
        onCancel={() => setPendingPct(null)}
        onConfirm={() => {
          if (!pendingPct) return;
          void removePctCode(pendingPct.id).then((result) => {
            if (result.errors.length) {
              push("bad", result.errors[0] ?? "Could not remove PCT.");
              setPendingPct(null);
              return;
            }
            if (editingPct === pendingPct.id) {
              setPctForm(blankPct);
              setEditingPct(null);
            }
            push("info", `Removed PCT ${pendingPct.pctCode}.`);
            setPendingPct(null);
          });
        }}
      />
    </div>
  );
}
