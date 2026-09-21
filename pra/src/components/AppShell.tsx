import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { CommandJump } from "./CommandJump";
import { KeyboardHelp } from "./KeyboardHelp";
import { ErrorBoundary } from "./ErrorBoundary";
import { LiveOpsHost } from "./LiveOpsHost";
import { Logo } from "./Logo";
import { OwnerHealthBanner } from "./OwnerHealthBanner";
import { useDesk } from "../context/DeskContext";
import { NoticeStack } from "../context/NoticeContext";
import { registrationDisplay } from "../domain/clients";
import { sectionPath } from "../domain/nav";
import { hasPracticePin, lockPractice } from "../domain/settings";
import { useDeskIdleLock } from "../hooks/useDeskIdleLock";
import { fiscalYearLabel } from "../lib/fiscalYear";
import { periodLabel } from "../lib/ids";
import { pushRecentClientId, readRecentClientIds } from "../lib/recentClients";
import type { Client } from "../types";

type NavItem = { to: string; label: string; end?: boolean };

const SWITCHER_CAP = 20;

const WORK: NavItem[] = [
  { to: "/today", label: "Today" },
  { to: "/", label: "Desk", end: true },
  { to: "/invoices", label: "Invoices" },
  { to: "/pos", label: "POS" },
  { to: "/reports", label: "Reports" },
  { to: "/returns", label: "Returns" },
  { to: "/psid", label: "PSID" },
];

const MASTERS: NavItem[] = [
  { to: "/clients", label: "Clients" },
  { to: "/buyers", label: "Buyers" },
  { to: "/items", label: "Items" },
];

const PRACTICE: NavItem[] = [
  { to: "/onboarding", label: "Connect PRA" },
  { to: "/settings", label: "Settings" },
];

const MORE_HREF = ["/clients", "/buyers", "/items", "/reports", "/pos", "/psid", "/settings"];

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" {...props} />
  );
}

function NavIcon({ name }: { name: string }) {
  if (name === "Desk") {
    return (
      <Icon>
        <path d="M4 11.5 12 5l8 6.5V20H4z" />
      </Icon>
    );
  }
  if (name === "Today") {
    return (
      <Icon>
        <path d="M5 7h2M5 12h2M5 17h2M10 7h9M10 12h9M10 17h9" />
      </Icon>
    );
  }
  if (name === "Invoices") {
    return (
      <Icon>
        <path d="M7 4h8l5 5v11H7z" />
        <path d="M15 4v5h5" />
      </Icon>
    );
  }
  if (name === "POS") {
    return (
      <Icon>
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <path d="M8 10h8M8 14h5" />
      </Icon>
    );
  }
  if (name === "Reports") {
    return (
      <Icon>
        <path d="M5 19V9M10 19V5M15 19v-7M20 19V8" />
      </Icon>
    );
  }
  if (name === "Returns") {
    return (
      <Icon>
        <rect x="5" y="5" width="14" height="14" rx="2" />
        <path d="M8 10h8M8 14h5" />
      </Icon>
    );
  }
  if (name === "PSID") {
    return (
      <Icon>
        <rect x="3" y="7" width="18" height="11" rx="2" />
        <path d="M3 11h18" />
      </Icon>
    );
  }
  if (name === "Clients") {
    return (
      <Icon>
        <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
        <path d="M3.5 19a4.5 4.5 0 0 1 9 0M11.5 19a4.5 4.5 0 0 1 9 0" />
      </Icon>
    );
  }
  if (name === "Buyers") {
    return (
      <Icon>
        <circle cx="12" cy="8" r="3" />
        <path d="M5 19a7 7 0 0 1 14 0" />
      </Icon>
    );
  }
  if (name === "Items") {
    return (
      <Icon>
        <path d="M4 8l8-4 8 4-8 4z" />
        <path d="M4 8v8l8 4 8-4V8" />
      </Icon>
    );
  }
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M6.2 17.8l1.4-1.4M16.4 7.6l1.4-1.4" />
    </Icon>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="nav-group">
      <p className="nav-label">{label}</p>
      {children}
    </div>
  );
}

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={sectionPath(item.to)} end={item.end === true}>
      <NavIcon name={item.label} />
      {item.label}
    </NavLink>
  );
}

function moreActive(pathname: string): boolean {
  return MORE_HREF.some((href) => pathname === href || pathname.endsWith(href) || pathname.includes(`${href}/`));
}

function fileLabel(row: { pntn: string; cnic: string; cnicAsRegistration?: boolean }): string {
  return registrationDisplay(row) || "No PNTN";
}

export function AppShell() {
  const { client, clients, period, chooseClient, setPeriod, settings } = useDesk();
  const location = useLocation();
  const switcherRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recentIds, setRecentIds] = useState(() => readRecentClientIds());
  const [moreOpen, setMoreOpen] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const live = client?.environment === "production";
  const canLock = hasPracticePin(settings);
  const setupOnly = clients.length === 0;
  const workItems = setupOnly ? [] : WORK;
  const masterItems = setupOnly ? MASTERS.filter((item) => item.to === "/clients") : MASTERS;
  useDeskIdleLock(canLock);

  const pool = useMemo(
    () => clients.filter((row) => !row.archived || row.id === client?.id),
    [clients, client?.id],
  );

  const recentClients = useMemo(() => {
    const byId = new Map(pool.map((row) => [row.id, row]));
    return recentIds.map((id) => byId.get(id)).filter((row): row is Client => Boolean(row));
  }, [pool, recentIds]);

  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? pool.filter((row) => {
          const hay = `${row.businessName} ${row.pntn} ${row.ntn ?? ""} ${row.personName ?? ""} ${row.city}`.toLowerCase();
          return hay.includes(needle);
        })
      : pool;
    return filtered.slice(0, SWITCHER_CAP);
  }, [pool, query]);

  const flatOptions = useMemo(() => {
    if (query.trim()) return listed;
    const recentSet = new Set(recentClients.map((row) => row.id));
    const rest = listed.filter((row) => !recentSet.has(row.id));
    return [...recentClients, ...rest].slice(0, SWITCHER_CAP);
  }, [query, listed, recentClients]);

  const activeId = flatOptions[active] ? `${listId}-${active}` : undefined;

  useEffect(() => {
    setMoreOpen(false);
    setSwitcherOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setActive(0);
  }, [query, flatOptions.length, switcherOpen]);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSwitcherOpen(false);
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  async function selectClient(id: string) {
    setRecentIds(pushRecentClientId(id));
    await chooseClient(id);
    setSwitcherOpen(false);
    setQuery("");
  }

  function onSwitcherKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSwitcherOpen(true);
      setActive((value) => Math.min(value + 1, Math.max(flatOptions.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      const row = flatOptions[active];
      if (switcherOpen && row) {
        event.preventDefault();
        void selectClient(row.id);
      }
    } else if (event.key === "Escape") {
      setSwitcherOpen(false);
    }
  }

  return (
    <div className="app">
      <a className="skip-link" href="#workspace">
        Skip to content
      </a>
      {live ? (
        <div className="env-strip" role="status">
          Live eIMS — production
        </div>
      ) : null}
      <header className="context-bar">
        <NavLink className="brand" to={sectionPath("/")} end>
          <Logo variant="wordmark" compact />
        </NavLink>
        <div className="client-switcher" ref={switcherRef}>
          <button
            type="button"
            className="client-switcher-btn"
            aria-expanded={switcherOpen}
            aria-haspopup="listbox"
            aria-controls={listId}
            onClick={() => setSwitcherOpen((open) => !open)}
          >
            <span>{client?.businessName ?? "Select a client"}</span>
            {client ? <small className="mono">{fileLabel(client)}</small> : null}
          </button>
          {switcherOpen ? (
            <div className="client-menu" role="presentation">
              {pool.length > 5 ? (
                <input
                  className="client-search"
                  type="search"
                  role="combobox"
                  placeholder="Search clients"
                  aria-label="Search clients"
                  aria-expanded={switcherOpen}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={activeId}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSwitcherOpen(true);
                  }}
                  onKeyDown={onSwitcherKey}
                  autoFocus
                />
              ) : null}
              <div id={listId} role="listbox" aria-label="Clients">
                {!query.trim() && recentClients.length > 0 ? (
                  <p className="client-section" id={`${listId}-recents`}>
                    Recent
                  </p>
                ) : null}
                {flatOptions.map((row, index) => {
                  const isRecent =
                    !query.trim() && recentClients.some((recent) => recent.id === row.id) && index < recentClients.length;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={row.id === client?.id || index === active}
                      className={
                        row.id === client?.id || index === active
                          ? isRecent
                            ? "client-item on recent"
                            : "client-item on"
                          : isRecent
                            ? "client-item recent"
                            : "client-item"
                      }
                      onMouseEnter={() => setActive(index)}
                      onClick={() => void selectClient(row.id)}
                    >
                      {row.businessName}
                      <span className="mono">{fileLabel(row)}</span>
                    </button>
                  );
                })}
                {flatOptions.length === 0 ? (
                  <p className="client-empty">{clients.length === 0 ? "No clients yet." : "No matching client."}</p>
                ) : null}
                {pool.length > SWITCHER_CAP && listed.length >= SWITCHER_CAP ? (
                  <p className="client-empty">Showing first {SWITCHER_CAP}. Type to narrow.</p>
                ) : null}
              </div>
              <NavLink className="client-manage" to={sectionPath("/clients")} onClick={() => setSwitcherOpen(false)}>
                Manage clients
              </NavLink>
            </div>
          ) : null}
        </div>
        {client ? (
          <>
            <span className={live ? "env-chip live" : "env-chip"}>{client.environment}</span>
            <span className="env-chip">
              {client.postingMode === "server" ? "server post" : "browser post"}
            </span>
          </>
        ) : setupOnly ? null : (
          <span className="env-chip">No file</span>
        )}
        {online ? null : (
          <span className="env-chip offline" role="status">
            Offline — posts wait until the network returns
          </span>
        )}
        {setupOnly ? null : (
          <label className="period-field">
            <span>Period</span>
            <input
              type="month"
              value={period}
              aria-label="Working period"
              lang="en-GB"
              onChange={(event) => void setPeriod(event.target.value)}
            />
            <small className="muted mono">
              {periodLabel(period)} · {fiscalYearLabel(period, settings?.fiscalYearStart ?? 7)}
            </small>
          </label>
        )}
        <KeyboardHelp />
        {canLock ? (
          <button className="lock-btn" type="button" onClick={() => lockPractice()}>
            Lock
          </button>
        ) : null}
      </header>
      <aside className="rail">
        <NavLink className="brand rail-brand" to={sectionPath("/")} end>
          <Logo variant="wordmark" />
        </NavLink>
        <nav className="nav" aria-label="Desk sections">
          {workItems.length ? (
            <Group label="Work">
              {workItems.map((item) => (
                <NavItemLink key={item.to} item={item} />
              ))}
            </Group>
          ) : null}
          <Group label="Masters">
            {masterItems.map((item) => (
              <NavItemLink key={item.to} item={item} />
            ))}
          </Group>
          <Group label="Practice">
            {PRACTICE.map((item) => (
              <NavItemLink key={item.to} item={item} />
            ))}
          </Group>
        </nav>
      </aside>
      <div className="stage">
        <OwnerHealthBanner />
        <LiveOpsHost>
          <main id="workspace" className="page wide" tabIndex={-1}>
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </LiveOpsHost>
      </div>
      <nav className="mobile-nav" aria-label="Primary">
        {moreOpen ? (
          <div className="more-panel">
            {[{ to: "/pos", label: "POS" }, { to: "/reports", label: "Reports" }, ...MASTERS, { to: "/psid", label: "PSID" }, ...PRACTICE].map(
              (item) => (
                <NavLink key={item.to} to={sectionPath(item.to)} onClick={() => setMoreOpen(false)}>
                  <NavIcon name={item.label} />
                  {item.label}
                </NavLink>
              ),
            )}
          </div>
        ) : null}
        <div className="mobile-nav-bar">
          <NavLink to={sectionPath("/today")}>
            <NavIcon name="Today" />
            Today
          </NavLink>
          <NavLink to={sectionPath("/")} end>
            <NavIcon name="Desk" />
            Desk
          </NavLink>
          <NavLink to={sectionPath("/invoices")}>
            <NavIcon name="Invoices" />
            Invoices
          </NavLink>
          <NavLink to={sectionPath("/returns")}>
            <NavIcon name="Returns" />
            Returns
          </NavLink>
          <button
            type="button"
            className={moreOpen || moreActive(location.pathname) ? "on" : undefined}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <NavIcon name="Settings" />
            More
          </button>
        </div>
      </nav>
      <CommandJump />
      <NoticeStack />
    </div>
  );
}
