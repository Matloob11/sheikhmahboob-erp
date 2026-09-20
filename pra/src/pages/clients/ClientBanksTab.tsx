import type { FormEvent } from "react";
import { AreaField, TextInput } from "../../components/Field";
import { Notice } from "../../components/Notice";
import { removeBank, type BankDraft } from "../../domain/banks";
import type { ClientBank } from "../../types";
import { blankBank } from "./helpers";

type ClientBanksTabProps = {
  banks: ClientBank[];
  bankForm: BankDraft;
  editingBank: string | null;
  bankErrors: string[];
  setBankForm: React.Dispatch<React.SetStateAction<BankDraft>>;
  setEditingBank: (id: string | null) => void;
  setBankErrors: (errors: string[]) => void;
  onSaveBank: (event: FormEvent) => void;
  onRemoved: () => void;
};

export function ClientBanksTab({
  banks,
  bankForm,
  editingBank,
  bankErrors,
  setBankForm,
  setEditingBank,
  setBankErrors,
  onSaveBank,
  onRemoved,
}: ClientBanksTabProps) {
  return (
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
