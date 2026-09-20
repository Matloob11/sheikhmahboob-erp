import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useDesk } from "../context/DeskContext";
import { matchJumpHits, type JumpHit } from "../domain/commandJump";
import { sectionPath } from "../domain/nav";
import { db } from "../db";
import { useLive } from "../hooks/useLive";
import type { Buyer } from "../types";

export function CommandJump() {
  const navigate = useNavigate();
  const { clients, invoices, client, chooseClient } = useDesk();
  const buyers = useLive(
    () => (client ? db.buyers.where("clientId").equals(client.id).toArray() : Promise.resolve([] as Buyer[])),
    [] as Buyer[],
    [client?.id],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const matches = useMemo(
    () =>
      matchJumpHits({
        query,
        clients,
        invoices,
        buyers,
      }),
    [query, clients, invoices, buyers],
  );

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => {
          if (!value) restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          return !value;
        });
        setQuery("");
        setActive(0);
      }
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close(): void {
    setOpen(false);
    const restore = restoreRef.current;
    restoreRef.current = null;
    window.setTimeout(() => restore?.focus(), 0);
  }

  function go(row: JumpHit) {
    void (async () => {
      if (row.clientId && row.clientId !== client?.id) await chooseClient(row.clientId);
      navigate(sectionPath(row.path));
      close();
    })();
  }

  function onPanelKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !panelRef.current) return;
    const nodes = [...panelRef.current.querySelectorAll<HTMLElement>("input, button")].filter(
      (node) => !node.hasAttribute("disabled"),
    );
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return (
    <div className="command-jump" role="presentation">
      <button className="command-jump-scrim" type="button" aria-label="Close jump list" onClick={close} />
      <div
        ref={panelRef}
        className="command-jump-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        onKeyDown={onPanelKey}
      >
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="USIN, buyer, client, or section…"
          aria-label="Search the desk"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            }
            if (event.key === "Enter") {
              const row = matches[active];
              if (row) go(row);
            }
          }}
        />
        <ul>
          {matches.map((row, index) => (
            <li key={`${row.kind}-${row.path}-${row.label}-${row.clientId ?? ""}`}>
              <button
                type="button"
                className={index === active ? "on" : undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(row)}
              >
                {row.label}
                <span className="mono">
                  {row.kind} · {row.hint}
                </span>
              </button>
            </li>
          ))}
          {matches.length === 0 ? <li className="muted">No match.</li> : null}
        </ul>
      </div>
    </div>
  );
}
