import { calendarDaysUntil, dueInstants } from "../lib/ids";
import { clientReadiness } from "./validate";
import type { Client, Invoice, PsidRecord, ReturnPeriod, ReturnStatus } from "../types";

/**
 * Where a client stands in the monthly chain. Order is urgency:
 * check an unclear post on IRIS / fix a failed one → post what is waiting → pay the PSID →
 * file the return → done.
 * `setup` means the file cannot post yet and nothing else is waiting on it.
 */
export type WorkStage = "fix" | "post" | "pay" | "file" | "setup" | "done";

export const WORK_STAGES: ReadonlyArray<WorkStage> = ["fix", "post", "pay", "file", "setup", "done"];

export const STAGE_LABEL: Record<WorkStage, string> = {
  fix: "Check or fix",
  post: "Post invoices",
  pay: "Pay PSID",
  file: "File return",
  setup: "Finish setup",
  done: "Done",
};

export interface ClientWorkRow {
  client: Client;
  stage: WorkStage;
  /** Plain next action for a clerk. */
  nextStep: string;
  /** Section path to open after choosing this client. */
  path: string;
  failed: number;
  /** Sent, but PRA's answer never arrived. Must be checked on IRIS before anything else. */
  unclear: number;
  /** Drafts and validated invoices not yet sent, any month. */
  toPost: number;
  psidOpen: number;
  psidPaid: number;
  returnStatus: ReturnStatus;
  setupGaps: string[];
  daysToPayment: number;
  daysToReturn: number;
  /** A deadline for the step this client is stuck on has passed. */
  overdue: boolean;
}

export interface WorkQueueInput {
  clients: ReadonlyArray<Client>;
  /** Every invoice that is not posted yet, across all clients. */
  openInvoices: ReadonlyArray<Invoice>;
  /** PSID rows; rows from other periods are ignored. */
  psids: ReadonlyArray<PsidRecord>;
  /** Return rows; rows from other periods are ignored. */
  returns: ReadonlyArray<ReturnPeriod>;
  period: string;
  now?: Date;
  /** When true, archived clients stay in the queue (Clients page). Default hides them. */
  includeArchived?: boolean;
}

const STAGE_RANK: Record<WorkStage, number> = { fix: 0, post: 1, pay: 2, file: 3, setup: 4, done: 5 };

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function buildWorkQueue(input: WorkQueueInput): ClientWorkRow[] {
  const now = input.now ?? new Date();
  const dues = dueInstants(input.period);
  const daysToPayment = calendarDaysUntil(dues.payment, now);
  const daysToReturn = calendarDaysUntil(dues.returnDue, now);

  // One pass per table, so 500 clients never means 500 scans.
  const failedBy = new Map<string, number>();
  const toPostBy = new Map<string, number>();
  const unclearBy = new Map<string, number>();
  for (const row of input.openInvoices) {
    if (row.status === "unknown") unclearBy.set(row.clientId, (unclearBy.get(row.clientId) ?? 0) + 1);
    else if (row.status === "failed") failedBy.set(row.clientId, (failedBy.get(row.clientId) ?? 0) + 1);
    else if (row.status === "draft" || row.status === "validated") {
      toPostBy.set(row.clientId, (toPostBy.get(row.clientId) ?? 0) + 1);
    }
  }
  const psidOpenBy = new Map<string, number>();
  const psidPaidBy = new Map<string, number>();
  for (const row of input.psids) {
    if (row.period !== input.period) continue;
    const settled = row.status === "paid" || row.status === "claimed";
    const bucket = settled ? psidPaidBy : psidOpenBy;
    bucket.set(row.clientId, (bucket.get(row.clientId) ?? 0) + 1);
  }
  const returnBy = new Map<string, ReturnStatus>();
  for (const row of input.returns) {
    if (row.period === input.period) returnBy.set(row.clientId, row.status);
  }

  const rows = input.clients
    .filter((client) => input.includeArchived || !client.archived)
    .map((client): ClientWorkRow => {
      const failed = failedBy.get(client.id) ?? 0;
      const unclear = unclearBy.get(client.id) ?? 0;
      const toPost = toPostBy.get(client.id) ?? 0;
      const psidOpen = psidOpenBy.get(client.id) ?? 0;
      const psidPaid = psidPaidBy.get(client.id) ?? 0;
      const returnStatus = returnBy.get(client.id) ?? "open";
      const setupGaps = clientReadiness(client);

      let stage: WorkStage;
      let nextStep: string;
      let path: string;
      if (unclear > 0) {
        stage = "fix";
        nextStep = `Check ${plural(unclear, "unclear invoice")} on IRIS`;
        path = "/invoices?status=unknown&scope=all";
      } else if (failed > 0) {
        stage = "fix";
        nextStep = `Fix ${plural(failed, "failed invoice")}`;
        path = "/invoices?status=failed&scope=all";
      } else if (toPost > 0 && setupGaps.length === 0) {
        stage = "post";
        nextStep = `Send ${plural(toPost, "invoice")} to PRA`;
        path = "/invoices?scope=all";
      } else if (setupGaps.length > 0 && (toPost > 0 || returnStatus !== "filed")) {
        stage = "setup";
        nextStep = setupGaps[0] ?? "Finish client setup";
        path = "/clients";
      } else if (psidOpen > 0) {
        stage = "pay";
        nextStep = `Pay ${plural(psidOpen, "PSID")}`;
        path = "/psid";
      } else if (returnStatus !== "filed") {
        stage = "file";
        nextStep = returnStatus === "ready" ? "Return ready — file on IRIS" : "Prepare the return";
        path = "/returns";
      } else {
        stage = "done";
        nextStep = "Nothing waiting";
        path = "/";
      }

      const overdue =
        stage === "done"
          ? false
          : stage === "file"
            ? daysToReturn < 0
            : daysToPayment < 0;

      return {
        client,
        stage,
        nextStep,
        path,
        failed,
        unclear,
        toPost,
        psidOpen,
        psidPaid,
        returnStatus,
        setupGaps,
        daysToPayment,
        daysToReturn,
        overdue,
      };
    });

  return rows.sort(
    (a, b) =>
      STAGE_RANK[a.stage] - STAGE_RANK[b.stage] ||
      a.client.businessName.localeCompare(b.client.businessName, undefined, { sensitivity: "base" }),
  );
}

export function stageCounts(rows: ReadonlyArray<ClientWorkRow>): Record<WorkStage, number> {
  const counts: Record<WorkStage, number> = { fix: 0, post: 0, pay: 0, file: 0, setup: 0, done: 0 };
  for (const row of rows) counts[row.stage] += 1;
  return counts;
}

/** `open` = every client that still has something waiting. */
export type WorkStageFilter = WorkStage | "all" | "open";

export function filterWorkQueue(
  rows: ReadonlyArray<ClientWorkRow>,
  filter: { stage: WorkStageFilter; text: string },
): ClientWorkRow[] {
  const needle = filter.text.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  return rows.filter((row) => {
    if (filter.stage === "open" && row.stage === "done") return false;
    if (filter.stage !== "all" && filter.stage !== "open" && row.stage !== filter.stage) return false;
    if (!needle) return true;
    if (row.client.businessName.toLowerCase().includes(needle)) return true;
    return digits.length >= 3 && (row.client.pntn ?? "").replace(/\D/g, "").includes(digits);
  });
}
