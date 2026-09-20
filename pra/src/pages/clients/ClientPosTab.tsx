import type { FormEvent } from "react";
import { SelectField, TextInput } from "../../components/Field";
import { Notice } from "../../components/Notice";
import { activatePosDevice, removePosDevice, type PosDeviceDraft } from "../../domain/posDevices";
import type { ClientDraft } from "../../domain/clients";
import type { ClientPlace, ClientPosDevice, Environment } from "../../types";
import { blankPos } from "./helpers";

type ClientPosTabProps = {
  form: ClientDraft;
  places: ClientPlace[];
  devices: ClientPosDevice[];
  posForm: PosDeviceDraft;
  editingPos: string | null;
  posErrors: string[];
  setForm: React.Dispatch<React.SetStateAction<ClientDraft>>;
  setPosForm: React.Dispatch<React.SetStateAction<PosDeviceDraft>>;
  setEditingPos: (id: string | null) => void;
  setPosErrors: (errors: string[]) => void;
  onSavePos: (event: FormEvent) => void;
  onActivated: () => void;
  onRemoved: () => void;
};

export function ClientPosTab({
  form,
  places,
  devices,
  posForm,
  editingPos,
  posErrors,
  setForm,
  setPosForm,
  setEditingPos,
  setPosErrors,
  onSavePos,
  onActivated,
  onRemoved,
}: ClientPosTabProps) {
  return (
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
                    onActivated();
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
                    onRemoved();
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
  );
}
