import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ActivityList } from "../components/ActivityList";
import { Logo } from "../components/Logo";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { Splash } from "../components/Splash";
import { TokenField } from "../components/TokenField";
import { useDesk } from "../context/DeskContext";
import {
  hasPracticePin,
  isPracticeUnlocked,
  subscribePracticeLock,
  unlockPractice,
  verifyPracticePin,
} from "../domain/settings";
import { recordDeskActivity } from "../lib/idleLock";
import { AboutSection } from "./settings/About";
import { BackupSection } from "./settings/Backup";
import { PostingStatusSection } from "./settings/PostingStatus";
import { PracticeSection } from "./settings/Practice";
import { SecuritySection } from "./settings/Security";
import { StaffSection } from "./settings/StaffSection";

const SECTIONS = [
  { href: "#practice", label: "Practice" },
  { href: "#security", label: "Security" },
  { href: "#backup", label: "Backup" },
  { href: "#staff", label: "Staff" },
  { href: "#posting", label: "Posting" },
  { href: "#about", label: "About" },
] as const;

export function PracticeGate({ children }: { children: ReactNode }) {
  const { settings, ready } = useDesk();
  const [unlocked, setUnlocked] = useState(isPracticeUnlocked);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => subscribePracticeLock(() => setUnlocked(isPracticeUnlocked())), []);

  if (!ready) {
    return <Splash title="Daftar" body="Loading desk…" />;
  }

  if (!hasPracticePin(settings) || unlocked) return children;

  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    const ok = await verifyPracticePin(pin, settings);
    if (!ok) {
      setError("That PIN does not match.");
      setPin("");
      return;
    }
    unlockPractice();
    recordDeskActivity();
    setUnlocked(true);
    setPin("");
    setError("");
  }

  return (
    <div className="lock-screen">
      <div className="lock-seal">
        <Logo variant="mark" />
        <p className="muted">Tax consultants, Lahore</p>
      </div>
      <div className="lock-side">
        <form className="stack lock-form" onSubmit={(event) => void unlock(event)}>
          <div>
            <h2 className="lock-title">Daftar is locked</h2>
            <p className="muted" style={{ margin: "10px 0 0" }}>
              Enter the practice PIN to open client files on this computer.
            </p>
          </div>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <TokenField
            label="Practice PIN"
            value={pin}
            onChange={setPin}
            autoComplete="current-password"
            hint="The PIN is never shown in activity."
          />
          <button className="btn stamp" type="submit">
            Unlock desk
          </button>
          <p className="muted lock-fine">
            Forgot the PIN? Clear this site’s data in the browser. Client files are lost unless you have a backup.
          </p>
        </form>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { events } = useDesk();

  return (
    <div className="stack settings-sections">
      <PageHeader
        title="Settings"
      />

      <nav className="settings-jump" aria-label="Settings sections">
        {SECTIONS.map((section) => (
          <a key={section.href} className="btn ghost" href={section.href}>
            {section.label}
          </a>
        ))}
      </nav>

      <PracticeSection />
      <SecuritySection />
      <BackupSection />
      <StaffSection />
      <PostingStatusSection />
      <AboutSection />

      <Panel title="Recent activity">
        <ActivityList events={events} empty="No activity yet on this computer." />
      </Panel>
    </div>
  );
}
