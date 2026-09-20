import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "../components/Badge";
import { NeedClient } from "../components/NeedClient";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { Skeleton } from "../components/Skeleton";
import { Sparkline } from "../components/Sparkline";
import { useDesk } from "../context/DeskContext";
import { registrationDisplay } from "../domain/clients";
import { attentionJump, computeFileLedger, worstAttentionSeverity } from "../domain/ledger";
import { sectionPath } from "../domain/nav";
import { dailyPostedBills, periodCompare, previousPeriod } from "../domain/reports";
import { formatLongDay, periodLabel } from "../lib/ids";
import { pkr } from "../lib/money";
import { environmentLabel, returnStatusLabel } from "../lib/statusLabel";
import { FirstRun } from "./FirstRun";

function daysCopy(days: number, noun: string): string {
  if (days > 1) return `${days} days to ${noun}`;
  if (days === 1) return `1 day to ${noun}`;
  if (days === 0) return `${noun} due today`;
  if (days === -1) return `${noun} overdue by 1 day`;
  return `${noun} overdue by ${Math.abs(days)} days`;
}

function DueBar({ days }: { days: number }) {
  const spent = Math.min(100, Math.max(4, ((30 - days) / 30) * 100));
  return (
    <div className={days < 0 ? "due-bar late" : "due-bar"} aria-hidden="true">
      <i style={{ width: `${spent}%` }} />
    </div>
  );
}

function severityLabel(severity: "high" | "medium" | "low"): string {
  if (severity === "high") return "Urgent";
  if (severity === "medium") return "Setup";
  return "Note";
}

function signed(value: number): string {
  if (value > 0) return `+${pkr(value)}`;
  if (value < 0) return `−${pkr(Math.abs(value))}`;
  return pkr(0);
}

export function DeskPage() {
  const { ready, clients, client, period, invoices, purchases, psids, ledger, attention, filing, chooseClient } =
    useDesk();
  const navigate = useNavigate();

  const prior = previousPeriod(period);
  const compare = useMemo(() => {
    if (!client || !ledger) return undefined;
    const previous = computeFileLedger({
      clientId: client.id,
      period: prior,
      invoices,
      purchases,
      psids,
    });
    return periodCompare(ledger, previous);
  }, [client, ledger, invoices, purchases, psids, prior]);

  const spark = useMemo(
    () => (client ? dailyPostedBills(invoices, client.id, period) : []),
    [client, invoices, period],
  );

  if (!ready) {
    return (
      <div className="stack" aria-busy="true" aria-label="Loading desk">
        <Skeleton variant="kpi" lines={4} />
        <Skeleton lines={4} />
      </div>
    );
  }

  if (!client || !ledger) {
    if (clients.length === 0) {
      return (
        <div className="stack">
          <FirstRun />
        </div>
      );
    }
    return (
      <NeedClient
        title="Open a file"
        body="Invoices, annexes and PSIDs attach to one taxpayer at a time."
      />
    );
  }

  async function jump(clientId: string, path: string) {
    await chooseClient(clientId);
    navigate(sectionPath(path));
  }

  return (
    <div className="stack">
      <PageHeader
        kicker={periodLabel(period)}
        title={client.businessName}
        actions={
          <>
            <Badge tone={filing?.status ?? "open"}>{returnStatusLabel(filing?.status ?? "open")}</Badge>
            <Badge tone={client.environment}>{environmentLabel(client.environment)}</Badge>
            <Link className="btn ghost" to={sectionPath("/reports")}>
              Reports
            </Link>
            <Link className="btn stamp" to={sectionPath("/invoices/new")}>
              New invoice
            </Link>
          </>
        }
      />

      <section className="kpi-row" aria-label="Period ledger">
        <article className="kpi">
          <span>Output tax</span>
          <b>{pkr(ledger.outputTax)}</b>
          <small>{ledger.saleCount} posted sales</small>
        </article>
        <article className="kpi">
          <span>Input tax</span>
          <b>{pkr(ledger.inputTax)}</b>
          <small>{ledger.purchases.length} Annex A lines</small>
        </article>
        <article className="kpi">
          <span>Net payable</span>
          <b>{pkr(ledger.netPayable)}</b>
          <small>Output less adjustable input</small>
        </article>
        <article className={ledger.psidGap > 0 ? "kpi gap" : "kpi"}>
          <span>PSID gap</span>
          <b>{pkr(ledger.psidGap)}</b>
          <small>{pkr(ledger.psidPaid)} paid so far</small>
        </article>
      </section>

      <section className="due-row" aria-label="Filing dates">
        <article className={ledger.daysToPayment < 0 ? "due-plate late" : "due-plate"}>
          <p className="kicker">Payment · 15th</p>
          <b>{formatLongDay(ledger.paymentDue)}</b>
          <DueBar days={ledger.daysToPayment} />
          <span>{daysCopy(ledger.daysToPayment, "payment")}</span>
        </article>
        <article className={ledger.daysToReturn < 0 ? "due-plate late" : "due-plate"}>
          <p className="kicker">Return · 18th</p>
          <b>{formatLongDay(ledger.returnDue)}</b>
          <DueBar days={ledger.daysToReturn} />
          <span>{daysCopy(ledger.daysToReturn, "return")}</span>
        </article>
        <article className="due-plate spark-plate">
          <p className="kicker">Posted sales</p>
          <Sparkline values={spark} />
        </article>
      </section>

      {compare ? (
        <section className="compare-row" aria-label={`Compared with ${periodLabel(prior)}`}>
          <p className="muted" style={{ margin: 0 }}>
            vs {periodLabel(prior)}
          </p>
          <span>Sales {compare.saleCount >= 0 ? `+${compare.saleCount}` : compare.saleCount}</span>
          <span>Output {signed(compare.outputTax)}</span>
          <span>Net {signed(compare.netPayable)}</span>
          <span>PSID gap {signed(compare.psidGap)}</span>
        </section>
      ) : null}

      <div className="split" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <Panel title="Needs attention">
          {attention.length === 0 ? (
            <p className="muted">All clients are in order for {periodLabel(period)}.</p>
          ) : (
            <ul className="attention">
              {attention.map((row) => {
                const severity = worstAttentionSeverity(row.reasons);
                return (
                  <li key={row.client.id} className={severity}>
                    <div className="attention-head">
                      <button
                        type="button"
                        className="attention-file"
                        onClick={() => void chooseClient(row.client.id)}
                      >
                        <strong>{row.client.businessName}</strong>
                        <span className="mono muted">{registrationDisplay(row.client) || "No PNTN"}</span>
                      </button>
                      <span className={`attention-sev ${severity}`}>{severityLabel(severity)}</span>
                    </div>
                    <ul>
                      {row.reasons.map((reason) => {
                        const dest = attentionJump(reason);
                        return (
                          <li key={reason}>
                            {reason}{" "}
                            <button
                              type="button"
                              className="attention-jump"
                              onClick={() => void jump(row.client.id, dest.path)}
                            >
                              {dest.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="This file" className="file-card">
          <table>
            <tbody>
              <tr>
                <td>Posted sales</td>
                <td className="mono">{ledger.saleCount}</td>
              </tr>
              <tr>
                <td>Drafts</td>
                <td className="mono">{ledger.draftInvoices}</td>
              </tr>
              <tr>
                <td>Failed at PRA</td>
                <td className="mono">{ledger.failedInvoices}</td>
              </tr>
              <tr>
                <td>Unpaid PSID</td>
                <td className="mono">{ledger.unpaidPsids}</td>
              </tr>
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 16 }}>
            <Link className="btn ghost" to={sectionPath("/returns")}>
              Build return pack
            </Link>
            <Link className="btn ghost" to={sectionPath("/psid")}>
              Record PSID
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
