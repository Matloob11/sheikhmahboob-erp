import { useEffect, useState } from "react";

export function KeyboardHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (!typing && event.key === "?") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return (
      <button
        className="lock-btn"
        type="button"
        onClick={() => setOpen(true)}
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
      >
        ?
      </button>
    );
  }

  return (
    <div className="modal-root" role="dialog" aria-labelledby="keys-title">
      <div className="modal stack">
        <h3 id="keys-title">Shortcuts</h3>
        <p className="muted" style={{ margin: 0 }}>
          Press <span className="mono">?</span> again or Escape to close.
        </p>
        <ul className="muted">
          <li>
            <span className="mono">Ctrl+K</span> — jump to a section, USIN, buyer or client
          </li>
          <li>
            <span className="mono">?</span> — this sheet
          </li>
        </ul>
        <button className="btn ghost" type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}
