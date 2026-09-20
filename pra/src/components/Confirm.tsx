import { useEffect, useId, useRef, type ReactNode } from "react";

export function Confirm({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  extraLabel,
  extraDanger,
  onExtra,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  extraLabel?: string;
  extraDanger?: boolean;
  onExtra?: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus lands on Cancel, so a stray Enter never deletes or posts live.
    panelRef.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const stops = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!panelRef.current?.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-root" role="presentation" onClick={onCancel}>
      <div
        ref={panelRef}
        className="modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="kicker">Confirm</p>
        <h3 id={titleId}>{title}</h3>
        <div id={bodyId} className="muted confirm-body">
          {typeof body === "string" ? <p>{body}</p> : body}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className={danger ? "btn warn" : "btn stamp"} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
          {extraLabel && onExtra ? (
            <button className={extraDanger ? "btn warn" : "btn ghost"} type="button" onClick={onExtra}>
              {extraLabel}
            </button>
          ) : null}
          <button className="btn ghost" type="button" data-cancel onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
