import type { FormEvent } from "react";
import { TextInput } from "../../components/Field";
import { Notice } from "../../components/Notice";
import { removePlace, type PlaceDraft } from "../../domain/places";
import type { ClientPlace } from "../../types";
import { blankPlace } from "./helpers";

type ClientPlacesTabProps = {
  places: ClientPlace[];
  placeForm: PlaceDraft;
  editingPlace: string | null;
  placeErrors: string[];
  setPlaceForm: React.Dispatch<React.SetStateAction<PlaceDraft>>;
  setEditingPlace: (id: string | null) => void;
  setPlaceErrors: (errors: string[]) => void;
  onSavePlace: (event: FormEvent) => void;
  onRemoved: () => void;
};

export function ClientPlacesTab({
  places,
  placeForm,
  editingPlace,
  placeErrors,
  setPlaceForm,
  setEditingPlace,
  setPlaceErrors,
  onSavePlace,
  onRemoved,
}: ClientPlacesTabProps) {
  return (
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
                  onRemoved();
                });
              }}
            >
              Remove
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
