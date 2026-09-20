import { useId, useState } from "react";

export function TokenField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  autoComplete = "off",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  const labelId = useId();
  return (
    <div className="field">
      <span id={labelId}>{label}</span>
      <div className="token-field">
        <input
          className="mono"
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          aria-labelledby={labelId}
          onChange={(event) => onChange(event.target.value)}
        />
        <button className="btn ghost" type="button" onClick={() => setVisible((current) => !current)}>
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {hint ? <small className="field-hint">{hint}</small> : null}
    </div>
  );
}
