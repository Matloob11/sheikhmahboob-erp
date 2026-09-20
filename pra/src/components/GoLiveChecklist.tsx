import { PRA_SANDBOX_TOKEN, type Client } from "../types";

export function looksLikeSandboxDemo(
  client: Pick<Client, "posId" | "posToken">,
): boolean {
  return client.posId.trim() === "100000" || client.posToken.trim() === PRA_SANDBOX_TOKEN;
}

export function GoLiveChecklist({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? "go-live compact" : "go-live"} aria-label="Go-live checklist">
      <p className="kicker">Live eIMS</p>
      <h3>{compact ? "This file still looks like sandbox" : "Before the first live post"}</h3>
      <ol>
        <li>
          Register the client's POS on{" "}
          <a href="https://reg.pra.punjab.gov.pk/" target="_blank" rel="noreferrer">
            reg.pra.punjab.gov.pk
          </a>{" "}
          → Registration → POS Client Registration. The POS ID and token come from there, not from
          IRIS. The sample sandbox token is not a live client.
        </li>
        <li>
          On the <strong>Pos Details</strong> tab of that form, enter this server's address{" "}
          <span className="mono">187.53.143.235</span>. PRA only accepts live invoices from an
          address it knows. If live posting is still refused, email{" "}
          <a href="mailto:eims@pra.punjab.gov.pk">eims@pra.punjab.gov.pk</a> with the PNTN, POS ID
          and this address.
        </li>
        <li>
          Send one live invoice, then check its fiscal number on the PRA portal under IMS Fiscal
          Report. PRA gives no way to look an invoice up from here, so that check is done by hand.
        </li>
      </ol>
      <p className="muted">
        Hosted Daftar starts empty. Do not load a sample taxpayer on the live desk.
      </p>
    </section>
  );
}
