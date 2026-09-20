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

type FieldControlProps = {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

function mergeDescribedBy(existing: string | undefined, errorId: string | undefined): string | undefined {
  if (!errorId) return existing;
  if (!existing) return errorId;
  return `${existing} ${errorId}`;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const autoId = useId();
  const errorId = useId();
  const child = Children.count(children) === 1 ? Children.only(children) : null;
  const givenId =
    isValidElement(child) && typeof (child.props as { id?: string }).id === "string"
      ? (child.props as { id?: string }).id
      : undefined;
  const id = htmlFor ?? givenId ?? autoId;
  const control =
    isValidElement(child)
      ? cloneElement(child as ReactElement<FieldControlProps>, {
          id: (child.props as FieldControlProps).id ?? id,
          "aria-invalid": error ? true : (child.props as FieldControlProps)["aria-invalid"],
          "aria-describedby": mergeDescribedBy(
            (child.props as FieldControlProps)["aria-describedby"],
            error ? errorId : undefined,
          ),
        })
      : children;

  return (
    <div className={error ? "field has-error" : "field"}>
      <label htmlFor={id}>{label}</label>
      {control}
      {error ? (
        <small className="field-error" id={errorId} role="alert">
          {error}
        </small>
      ) : hint ? (
        <small className="field-hint">{hint}</small>
      ) : null}
    </div>
  );
}

export function TextInput(
  props: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string },
) {
  const { label, hint, error, id, ...rest } = props;
  const autoId = useId();
  const controlId = id ?? autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={controlId}>
      <input id={controlId} {...rest} />
    </Field>
  );
}

/** Number field that keeps "1." while typing and only commits a number on blur. */
export function AmountInput({
  label,
  hint,
  error,
  value,
  onValueChange,
  disabled,
  id,
  "aria-label": ariaLabel,
  className,
  onKeyDown,
  "data-line-row": dataLineRow,
  "data-line-col": dataLineCol,
}: {
  label?: string;
  hint?: string;
  error?: string;
  value: number;
  onValueChange: (value: number) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
  onKeyDown?: InputHTMLAttributes<HTMLInputElement>["onKeyDown"];
  "data-line-row"?: number;
  "data-line-col"?: string;
}) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const errorId = useId();
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
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
      data-line-row={dataLineRow}
      data-line-col={dataLineCol}
      value={text}
      onKeyDown={onKeyDown}
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

  if (!label) {
    return (
      <>
        {input}
        {error ? (
          <small className="field-error" id={errorId} role="alert">
            {error}
          </small>
        ) : null}
      </>
    );
  }
  return (
    <Field label={label} hint={hint} error={error} htmlFor={controlId}>
      {input}
    </Field>
  );
}

export function SelectField(
  props: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string },
) {
  const { label, hint, error, id, children, ...rest } = props;
  const autoId = useId();
  const controlId = id ?? autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={controlId}>
      <select id={controlId} {...rest}>
        {children}
      </select>
    </Field>
  );
}

export function AreaField(
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string },
) {
  const { label, hint, error, id, ...rest } = props;
  const autoId = useId();
  const controlId = id ?? autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={controlId}>
      <textarea id={controlId} rows={3} {...rest} />
    </Field>
  );
}
