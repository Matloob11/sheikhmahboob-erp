import { useMemo, useState } from "react";
import { searchCatalogItems, searchPctCodes } from "../domain/catalog";
import type { CatalogItem, PctCode } from "../types";
import { SearchPick } from "./SearchPick";

export function ItemPicker({
  items,
  disabled,
  onPick,
}: {
  items: ReadonlyArray<CatalogItem>;
  disabled?: boolean;
  onPick: (item: CatalogItem) => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => searchCatalogItems(items, query).slice(0, 12), [items, query]);

  return (
    <SearchPick
      label="Find an item"
      query={query}
      onQuery={setQuery}
      options={options}
      getKey={(row) => row.id}
      disabled={disabled}
      placeholder={items.length ? "Search item name or code" : "No items in this file yet"}
      empty={items.length ? "No item matches that search." : "Add items on the Items page."}
      onSelect={(row) => {
        onPick(row);
        setQuery(row.itemName);
      }}
      renderOption={(row) => (
        <>
          <strong>{row.itemName}</strong>
          <span className="mono">
            {row.itemCode} · {row.pctCode} · {row.taxRate}%
          </span>
        </>
      )}
    />
  );
}

export function PctPicker({
  rates,
  disabled,
  onPick,
}: {
  rates: ReadonlyArray<PctCode>;
  disabled?: boolean;
  onPick: (rate: PctCode) => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => searchPctCodes(rates, query).slice(0, 12), [rates, query]);

  return (
    <SearchPick
      label="Find a PCT / HS rate"
      query={query}
      onQuery={setQuery}
      options={options}
      getKey={(row) => row.id}
      disabled={disabled}
      placeholder="Search PCT code or service"
      empty="No PCT matches that search."
      onSelect={(row) => {
        onPick(row);
        setQuery(`${row.pctCode} ${row.name}`);
      }}
      renderOption={(row) => (
        <>
          <strong>{row.name}</strong>
          <span className="mono">
            {row.pctCode} · {row.taxRate}%
          </span>
        </>
      )}
    />
  );
}
