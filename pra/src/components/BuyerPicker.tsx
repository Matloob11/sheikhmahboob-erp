import { useMemo, useState } from "react";
import { searchBuyers } from "../domain/buyers";
import type { Buyer } from "../types";
import { PhoneLinks } from "./PhoneLinks";
import { SearchPick } from "./SearchPick";

export function BuyerPicker({
  buyers,
  disabled,
  onPick,
}: {
  buyers: ReadonlyArray<Buyer>;
  onPick: (buyer: Buyer) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => searchBuyers(buyers, query).slice(0, 12), [buyers, query]);
  const hit = options.length === 1 ? options[0] : undefined;

  return (
    <div className="stack">
      <SearchPick
        label="Find a buyer"
        query={query}
        onQuery={setQuery}
        options={options}
        getKey={(row) => row.id}
        disabled={disabled}
        placeholder={buyers.length ? "Search name, PNTN, CNIC or phone" : "No saved buyers yet"}
        empty={buyers.length ? "No buyer matches that search." : "Save a buyer from the header, or open Buyers."}
        onSelect={(row) => {
          onPick(row);
          setQuery(row.name);
        }}
        renderOption={(row) => (
          <>
            <strong>{row.name}</strong>
            <span className="mono">
              {row.pntn || "No PNTN"}
              {row.phone ? ` · ${row.phone}` : ""}
            </span>
          </>
        )}
      />
      {hit?.phone ? <PhoneLinks phone={hit.phone} name={hit.name} /> : null}
    </div>
  );
}
