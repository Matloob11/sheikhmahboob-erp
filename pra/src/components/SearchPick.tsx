import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export function SearchPick<T>({
  label,
  query,
  onQuery,
  options,
  getKey,
  renderOption,
  onSelect,
  disabled,
  placeholder,
  empty,
}: {
  label: string;
  query: string;
  onQuery: (value: string) => void;
  options: ReadonlyArray<T>;
  getKey: (row: T) => string;
  renderOption: (row: T) => ReactNode;
  onSelect: (row: T) => void;
  disabled?: boolean;
  placeholder?: string;
  empty?: string;
}) {
  const listId = useId();
  const inputId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const activeId = options[active] ? `${listId}-${active}` : undefined;

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query, options.length]);

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((value) => Math.min(value + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      const row = options[active];
      if (open && row) {
        event.preventDefault();
        onSelect(row);
        setOpen(false);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="search-pick" ref={root}>
      <div className="field">
        <label htmlFor={inputId}>{label}</label>
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? activeId : undefined}
          disabled={disabled}
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            onQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
      </div>
      {open && !disabled ? (
        <ul className="search-pick-list" id={listId} role="listbox">
          {options.map((row, index) => (
            <li key={getKey(row)}>
              <button
                type="button"
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={index === active ? "search-pick-option on" : "search-pick-option"}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  onSelect(row);
                  setOpen(false);
                }}
              >
                {renderOption(row)}
              </button>
            </li>
          ))}
          {options.length === 0 ? <li className="search-pick-empty muted">{empty ?? "No match."}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
