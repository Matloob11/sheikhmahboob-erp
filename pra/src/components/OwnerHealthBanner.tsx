import { useEffect, useState } from "react";
import { apiRole, hasApiToken } from "../lib/apiSync";
import { fetchOwnerPostStatus, type OwnerPostStatus } from "../lib/postApi";

const LAPTOP_PULL_KEY = "daftar.pgBackupPulledAt";
const STALE_SEC = 36 * 60 * 60;

function ageLabel(sec: number | null): string {
  if (sec == null) return "unknown";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export function OwnerHealthBanner() {
  const [status, setStatus] = useState<OwnerPostStatus | null>(null);
  const [laptopAgeSec, setLaptopAgeSec] = useState<number | null>(null);
  const owner = apiRole() === "owner" && hasApiToken();

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    async function load() {
      try {
        const s = await fetchOwnerPostStatus();
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) {
          setStatus({
            apiUp: false,
            postgresUp: false,
            newestBackupAgeSec: null,
            newestBackupAt: null,
            depth: { pending: 0, sending: 0, posted: 0, failed: 0, unknown: 0 },
            oldestPendingAgeSec: null,
            lastErrorByClient: [],
          });
        }
      }
      const raw = localStorage.getItem(LAPTOP_PULL_KEY);
      if (raw) {
        const ms = Date.parse(raw);
        if (Number.isFinite(ms)) setLaptopAgeSec(Math.floor((Date.now() - ms) / 1000));
      } else {
        setLaptopAgeSec(null);
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [owner]);

  if (!owner || !status) return null;

  const problems: string[] = [];
  if (!status.apiUp) problems.push("API down");
  if (!status.postgresUp) problems.push("Postgres down");
  if (status.newestBackupAgeSec == null || status.newestBackupAgeSec > STALE_SEC) {
    problems.push(
      status.newestBackupAgeSec == null
        ? "No server backup marker yet"
        : `Server backup ${ageLabel(status.newestBackupAgeSec)} old`,
    );
  }
  if (laptopAgeSec == null || laptopAgeSec > STALE_SEC) {
    problems.push(
      laptopAgeSec == null
        ? "No laptop backup pull marked"
        : `Laptop pull ${ageLabel(laptopAgeSec)} old`,
    );
  }

  if (!problems.length) return null;

  return (
    <div className="alert bad" role="alert" style={{ margin: 0, borderRadius: 0 }}>
      Owner alert: {problems.join(" · ")}. Open Settings → Posting.
    </div>
  );
}

export function markLaptopBackupPulled(): void {
  localStorage.setItem(LAPTOP_PULL_KEY, new Date().toISOString());
}
