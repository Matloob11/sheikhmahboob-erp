import { useState, type FormEvent } from "react";
import { Notice } from "../components/Notice";
import { SelectField, TextInput } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { TokenField } from "../components/TokenField";
import { useDesk } from "../context/DeskContext";
import { emptyClientDraft, saveClient, type ClientDraft } from "../domain/clients";
import { patchSettings } from "../domain/settings";
import { validateClient } from "../domain/validate";
import { cabinetWarning } from "../lib/cabinet";
import { PRA_SANDBOX_TOKEN, type Environment } from "../types";

const STEPS = [
  { n: 1, title: "Practice name", body: "This name sits on the desk. Client files stay in this browser." },
  { n: 2, title: "First client", body: "Invoices, annexes and PSIDs attach to one taxpayer file." },
  { n: 3, title: "POS ID and token", body: "From PRA IRIS → eIMS / POS registration. Sandbox can wait." },
  { n: 4, title: "Add a buyer later", body: "Buyers are optional. Add them when you write an invoice." },
] as const;

function sampleSandboxFile(): ClientDraft {
  return {
    ...emptyClientDraft,
    businessName: "Demo Traders (Sandbox)",
    brandName: "Demo",
    pntn: "1234567-8",
    phone: "03001234567",
    email: "demo@example.com",
    address: "Lahore",
    city: "Lahore",
    posId: "100000",
    posToken: PRA_SANDBOX_TOKEN,
    notes: "Sample client. Replace POS ID and token before live posting.",
  };
}

export function FirstRun() {
  const { settings } = useDesk();
  const [step, setStep] = useState<(typeof STEPS)[number]["n"]>(1);
  const [firmName, setFirmName] = useState(settings?.firmName || "My practice");
  const [file, setFile] = useState<ClientDraft>(emptyClientDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const current = STEPS[step - 1] ?? STEPS[0];

  function set<K extends keyof ClientDraft>(key: K, value: ClientDraft[K]) {
    setFile((current) => ({ ...current, [key]: value }));
  }

  async function savePractice(): Promise<boolean> {
    await patchSettings({ firmName: firmName.trim() || "My practice" });
    return true;
  }

  async function openFile(): Promise<boolean> {
    const result = await saveClient(file);
    setErrors(result.errors);
    return result.errors.length === 0;
  }

  async function goNext(event: FormEvent) {
    event.preventDefault();
    setErrors([]);
    if (step === 1) {
      setBusy(true);
      try {
        await savePractice();
        setStep(2);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === 2) {
      const nextErrors = validateClient({ ...file, posId: "", posToken: "", environment: "sandbox" });
      setErrors(nextErrors);
      if (nextErrors.length) return;
      setStep(3);
      return;
    }
    if (step === 3) {
      const nextErrors = validateClient(file);
      setErrors(nextErrors);
      if (nextErrors.length) return;
      setStep(4);
      return;
    }
    setBusy(true);
    try {
      await savePractice();
      await openFile();
    } finally {
      setBusy(false);
    }
  }

  async function loadSample() {
    setBusy(true);
    setErrors([]);
    try {
      await savePractice();
      const result = await saveClient(sampleSandboxFile());
      setErrors(result.errors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="first-run stack">
      <PageHeader
        kicker="First run"
        title={current.title}
        description={current.body}
      />

      <ol className="first-run-steps" aria-label="Setup steps">
        {STEPS.map((row) => (
          <li key={row.n} className={row.n === step ? "on" : undefined} aria-current={row.n === step ? "step" : undefined}>
            {row.n}. {row.title}
          </li>
        ))}
      </ol>

      {errors.length ? (
        <Notice tone="bad">
          {errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </Notice>
      ) : null}

      <form className="stack" onSubmit={(event) => void goNext(event)}>
        {step === 1 ? (
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              {cabinetWarning(import.meta.env.PROD)}
            </p>
            <TextInput
              label="Practice name"
              required
              value={firmName}
              onChange={(event) => setFirmName(event.target.value)}
              placeholder="My practice"
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="stack">
            <div className="form-grid">
              <TextInput
                label="Business name"
                required
                value={file.businessName}
                onChange={(event) => set("businessName", event.target.value)}
              />
              <TextInput
                label="PNTN"
                className="mono"
                value={file.pntn}
                onChange={(event) => set("pntn", event.target.value)}
                placeholder="1234567-8"
                hint="Optional now. Needed before a live return."
              />
              <TextInput
                label="CNIC"
                className="mono"
                value={file.cnic}
                onChange={(event) => set("cnic", event.target.value)}
              />
              <TextInput label="Phone" value={file.phone} onChange={(event) => set("phone", event.target.value)} />
              <TextInput label="Email" value={file.email} onChange={(event) => set("email", event.target.value)} />
              <TextInput label="City" value={file.city} onChange={(event) => set("city", event.target.value)} />
              <TextInput
                label="Address"
                value={file.address}
                onChange={(event) => set("address", event.target.value)}
              />
              <SelectField
                label="Environment"
                value={file.environment}
                onChange={(event) => set("environment", event.target.value as Environment)}
              >
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </SelectField>
            </div>
            <label className="row">
              <input
                type="checkbox"
                checked={file.cnicAsRegistration === true}
                onChange={(event) => set("cnicAsRegistration", event.target.checked)}
              />
              CNIC is the registration number
            </label>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="stack">
            <TextInput
              label="POS ID"
              className="mono"
              value={file.posId}
              onChange={(event) => set("posId", event.target.value)}
              hint={file.environment === "sandbox" ? "Optional for sandbox." : "From IRIS eIMS / POS registration."}
            />
            <TokenField
              label="eIMS token"
              value={file.posToken}
              onChange={(value) => set("posToken", value)}
              placeholder="Bearer token from PRA IRIS"
              hint="Paste the token only — the desk adds the Bearer header."
            />
          </div>
        ) : null}

        {step === 4 ? (
          <p className="muted" style={{ margin: 0 }}>
            {file.businessName.trim() || "This file"} is ready. Skip buyers for now, or add them later from
            Buyers.
          </p>
        ) : null}

        <div className="row">
          {step > 1 ? (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => setStep((current) => (current === 1 ? 1 : ((current - 1) as 1 | 2 | 3)))}>
              Back
            </button>
          ) : null}
          <button className="btn stamp" type="submit" disabled={busy}>
            {step === 4 ? "Open this file" : "Continue"}
          </button>
        </div>
      </form>

      {import.meta.env.DEV ? (
        <p className="muted" style={{ margin: 0 }}>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void loadSample()}>
            Load sample sandbox file
          </button>
        </p>
      ) : null}
    </div>
  );
}
