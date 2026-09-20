import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { amountFromDraft, amountTextFromNumber, nextAmountDraft } from "../lib/money";

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const autoId = useId();
  const child = Children.count(children) === 1 ? Children.only(children) : null;
  const givenId =
    isValidElement(child) && typeof (child.props as { id?: string }).id === "string"
      ? (child.props as { id?: string }).id
      : undefined;
  const id = htmlFor ?? givenId ?? autoId;
  const control =
    isValidElement(child) && !(child.props as { id?: string }).id
      ? cloneElement(child as ReactElement<{ id?: string }>, { id })
      : children;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control}
      {hint ? <small className="field-hint">{hint}</small> : null}
    </div>
  );
}

export function TextInput(
  props: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string },
) {
  const { label, hint, id, ...rest } = props;
  const autoId = useId();
  const controlId = id ?? autoId;
  return (
    <Field label={label} hint={hint} htmlFor={controlId}>
      <input id={controlId} {...rest} />
    </Field>
  );
}

/** Number field that keeps "1." while typing and only commits a number on blur. */
export function AmountInput({
  label,
  hint,
  value,
  onValueChange,
  disabled,
  id,
  "aria-label": ariaLabel,
  className,
}: {
  label?: string;
  hint?: string;
  value: number;
  onValueChange: (value: number) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const [text, setText] = useState(() => amountTextFromNumber(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(amountTextFromNumber(value));
  }, [value, focused]);

  const input = (
    <input
      id={controlId}
      className={className}
      inputMode="decimal"
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(event) => {
        const next = nextAmountDraft(text, event.target.value);
        setText(next);
        const cleaned = next.replace(/,/g, "").trim();
        if (cleaned !== "" && cleaned !== "." && !cleaned.endsWith(".")) {
          onValueChange(amountFromDraft(next));
        }
      }}
      onBlur={() => {
        setFocused(false);
        const n = amountFromDraft(text);
        setText(amountTextFromNumber(n));
        onValueChange(n);
      }}
    />
  );

  if (!label) return input;
  return (
    <Field label={label} hint={hint} htmlFor={controlId}>
      {input}
    </Field>
  );
}

export function SelectField(
  props: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string },
) {
  const { label, hint, id, children, ...rest } = props;
  const autoId = useId();
  const controlId = id ?? autoId;
  return (
    <Field label={label} hint={hint} htmlFor={controlId}>
      <select id={controlId} {...rest}>
        {children}
      </select>
    </Field>
  );
}

export function AreaField(
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string },
) {
  const { label, hint, id, ...rest } = props;
  const autoId = useId();
  const controlId = id ?? autoId;
  return (
    <Field label={label} hint={hint} htmlFor={controlId}>
      <textarea id={controlId} rows={3} {...rest} />
    </Field>
  );
}
