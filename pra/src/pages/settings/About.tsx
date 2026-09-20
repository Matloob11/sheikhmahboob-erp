import { useState } from "react";
import { Logo } from "../../components/Logo";
import { Panel } from "../../components/Panel";
import { useDesk } from "../../context/DeskContext";
import { APP_VERSION, formatBuildStamp } from "../../lib/buildInfo";
import { checkImsHealth, type ImsHealth } from "../../lib/imsHealth";

const WHITELIST_IP = "187.53.143.235";

export function AboutSection() {
  const { firmName } = useDesk();
  const [health, setHealth] = useState<ImsHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const subject = `eIMS / POS IP whitelist — ${firmName} — PNTN [1234567-8]`;
  const body = [
    "Dear eIMS team,",
    "",
    "Please whitelist the following production IP for PRA eIMS PostData.",
    "",
    "PNTN: [1234567-8]",
    `Business name: ${firmName}`,
    "POS ID: [from IRIS → eIMS / POS registration]",
    `Server IP: ${WHITELIST_IP}`,
    "Location: [city / branch]",
    "",
    "We post from this server to https://ims.pral.com.pk/ims/production/api/Live/PostData.",
    "",
    "Regards,",
    "[Name]",
    "[Phone]",
  ].join("\n");
  const mailto = `mailto:eims@pra.punjab.gov.pk?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <Panel title="About">
      <div id="about" className="about">
        <Logo variant="wordmark" />
        <p className="muted build-stamp" style={{ margin: 0 }}>
          Daftar <span className="mono">{APP_VERSION}</span>
          <br />
          Built {formatBuildStamp()}
        </p>
        <p style={{ margin: 0 }}>
          Local-first — IRIS login is not copied. Official login, notices, and 1Bill PSID creation stay on PRA
          IRIS.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Production PostData only accepts a whitelisted IP. This leftover is not done: send the email. Until
          PRA replies, live posts can fail even with a real token. Proxy IP:{" "}
          <span className="mono">{WHITELIST_IP}</span>.
        </p>
        <p style={{ margin: 0 }}>
          <a href={mailto}>Email eims@pra.punjab.gov.pk</a>
          {" — "}opens a draft with the whitelist text.
        </p>
        <div className="row">
          <button
            className="btn ghost"
            type="button"
            disabled={checking}
            onClick={() => {
              setChecking(true);
              void checkImsHealth()
                .then(setHealth)
                .finally(() => setChecking(false));
            }}
          >
            {checking ? "Checking PRA link…" : "Check /pra-ims (no post)"}
          </button>
        </div>
        {health ? (
          <p className={health.ok ? "muted" : "alert bad"} style={{ margin: 0 }}>
            {health.via} · HTTP {health.status || "—"} · {health.detail}
          </p>
        ) : null}
        <pre className="about-copy">{body}</pre>
        <ul className="pra-links">
          <li>
            <a href="https://e.pra.punjab.gov.pk/public/txplogin.xhtml" target="_blank" rel="noreferrer">
              PRA IRIS login
            </a>
          </li>
          <li>
            <a
              href="https://e.pra.punjab.gov.pk/templates/POS_COMPONENT_and_eIMS_User_Manual.pdf"
              target="_blank"
              rel="noreferrer"
            >
              eIMS / POS manual
            </a>
          </li>
          <li>
            <a
              href="https://e.pra.punjab.gov.pk/templates/PRA_Iris_User_Manual_Version4.pdf"
              target="_blank"
              rel="noreferrer"
            >
              Sales tax return manual
            </a>
          </li>
          <li>
            <a href="https://reg.pra.punjab.gov.pk/ptms/TaxeCalander.aspx" target="_blank" rel="noreferrer">
              PRA tax calendar (15th payment / 18th return)
            </a>
          </li>
        </ul>
      </div>
    </Panel>
  );
}
