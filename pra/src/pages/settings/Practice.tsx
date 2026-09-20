import { useState } from "react";
import { Notice } from "../../components/Notice";
import { Panel } from "../../components/Panel";
import { useDesk } from "../../context/DeskContext";
import { useNotice } from "../../context/NoticeContext";
import { patchSettings } from "../../domain/settings";
import { writeTheme, type DeskTheme } from "../../lib/theme";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function PracticeSection() {
  const { firmName, settings } = useDesk();
  const { push } = useNotice();
  const [name, setName] = useState<string | null>(null);
  const [yearStart, setYearStart] = useState(settings?.fiscalYearStart ?? 7);
  const theme: DeskTheme = "light";
  const [saved, setSaved] = useState(false);
  const firm = name ?? firmName;

  async function save() {
    await patchSettings({
      firmName: firm.trim() || "My practice",
      fiscalYearStart: yearStart,
      theme,
    });
    writeTheme(theme);
    setSaved(true);
    push("good", "Practice saved.");
  }

  return (
    <Panel title="Practice">
      <div id="practice" className="stack">
        <p className="muted" style={{ margin: 0 }}>
          The name on this browser. Client files stay here; IRIS login is not copied.
        </p>
        <label className="field">
          <span>Practice / firm name</span>
          <input
            value={firm}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            placeholder="e.g. Khan & Co. Tax Advisors"
          />
        </label>
        <label className="field">
          <span>Fiscal year starts</span>
          <select
            value={yearStart}
            onChange={(event) => {
              setYearStart(Number(event.target.value));
              setSaved(false);
            }}
          >
            {MONTHS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn stamp" type="button" onClick={() => void save()}>
          Save practice
        </button>
        {saved ? <Notice tone="good">Practice saved on this computer.</Notice> : null}
      </div>
    </Panel>
  );
}
