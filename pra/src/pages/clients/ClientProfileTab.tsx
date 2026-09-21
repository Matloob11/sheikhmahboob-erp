import { Link } from "react-router-dom";
import type { FormEvent } from "react";
import { AreaField, SelectField, TextInput } from "../../components/Field";
import { Notice } from "../../components/Notice";
import { PhoneLinks } from "../../components/PhoneLinks";
import { TokenField } from "../../components/TokenField";
import { type ClientDraft } from "../../domain/clients";
import { sectionPath } from "../../domain/nav";
import {
  PERSON_TYPES,
  SECTORS,
  type Client,
  type Environment,
  type PersonType,
} from "../../types";

type ClientProfileTabProps = {
  form: ClientDraft;
  editing: string | null;
  creating: boolean;
  errors: string[];
  clients: Client[];
  mergeInto: string;
  set: <K extends keyof ClientDraft>(key: K, value: ClientDraft[K]) => void;
  setDirty: (dirty: boolean) => void;
  setCreating: (creating: boolean) => void;
  setMergeInto: (id: string) => void;
  setMergeOpen: (open: boolean) => void;
  onSave: (event: FormEvent) => void;
  onAskRemove: (id: string, name: string) => void;
  onChooseClient: (id: string) => void;
  onPrefillSandbox: () => void;
};

export function ClientProfileTab({
  form,
  editing,
  creating,
  errors,
  clients,
  mergeInto,
  set,
  setDirty,
  setCreating,
  setMergeInto,
  setMergeOpen,
  onSave,
  onAskRemove,
  onChooseClient,
  onPrefillSandbox,
}: ClientProfileTabProps) {
  return (
    <form className="stack" onSubmit={(event) => void onSave(event)}>
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
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Posting mode:{" "}
          <strong className="mono">{form.postingMode === "server" ? "server" : "browser"}</strong>
          {" — "}change under Settings → Posting (owner). Default is browser.
        </p>
        {editing ? (
          <p style={{ margin: "8px 0 0" }}>
            <Link to={sectionPath(`/clients/${editing}/go-live`)}>Open go-live checklist</Link>
          </p>
        ) : null}
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
            onClick={onPrefillSandbox}
          >
            Prefill sandbox
          </button>
        ) : null}
        {editing ? (
          <>
            <Link className="btn ghost" to={sectionPath("/invoices/new")} onClick={() => void onChooseClient(editing)}>
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
            <button className="btn ghost" type="button" onClick={() => void onAskRemove(editing, form.businessName)}>
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
  );
}
