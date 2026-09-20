import { describe, expect, it } from "vitest";
import { buildWorkQueue, filterWorkQueue, stageCounts, type WorkStage } from "./today";
import type { Client, Invoice, PsidRecord, ReturnPeriod } from "../types";

function client(id: string, extra: Partial<Client> = {}): Client {
  return {
    id,
    businessName: `Client ${id}`,
    pntn: "1234567-8",
    posId: "100000",
    posToken: "real-token",
    environment: "production",
    archived: false,
    ...extra,
  } as Client;
}

function invoice(clientId: string, status: Invoice["status"], id = `${clientId}-${status}`): Invoice {
  return { id, clientId, status, usin: id, dateTime: "2026-09-10 10:00:00" } as Invoice;
}

function psid(clientId: string, status: PsidRecord["status"], period = "2026-09"): PsidRecord {
  return { id: `${clientId}-${status}`, clientId, period, status, amount: 100 } as PsidRecord;
}

function ret(clientId: string, status: ReturnPeriod["status"], period = "2026-09"): ReturnPeriod {
  return { id: `${clientId}-ret`, clientId, period, status } as ReturnPeriod;
}

const now = new Date(2026, 9, 10); // 10 Oct 2026: 5 days to the 15th, 8 to the 18th

function stageOf(rows: ReturnType<typeof buildWorkQueue>, id: string): WorkStage | undefined {
  return rows.find((row) => row.client.id === id)?.stage;
}

describe("buildWorkQueue", () => {
  it("puts a failed post ahead of everything else for that client", () => {
    const rows = buildWorkQueue({
      clients: [client("a")],
      openInvoices: [invoice("a", "failed"), invoice("a", "draft")],
      psids: [psid("a", "generated")],
      returns: [],
      period: "2026-09",
      now,
    });
    expect(rows[0]?.stage).toBe("fix");
    expect(rows[0]?.failed).toBe(1);
    expect(rows[0]?.toPost).toBe(1);
    expect(rows[0]?.path).toBe("/invoices?status=failed&scope=all");
  });

  it("puts an unclear post first: it must be checked on IRIS before any retry", () => {
    const rows = buildWorkQueue({
      clients: [client("a")],
      openInvoices: [invoice("a", "unknown"), invoice("a", "failed")],
      psids: [],
      returns: [],
      period: "2026-09",
      now,
    });
    expect(rows[0]?.stage).toBe("fix");
    expect(rows[0]?.unclear).toBe(1);
    expect(rows[0]?.nextStep).toBe("Check 1 unclear invoice on IRIS");
    expect(rows[0]?.path).toBe("/invoices?status=unknown&scope=all");
  });

  it("walks the monthly chain: post, then pay, then file, then done", () => {
    const rows = buildWorkQueue({
      clients: [client("post"), client("pay"), client("file"), client("done")],
      openInvoices: [invoice("post", "validated")],
      psids: [psid("pay", "generated"), psid("file", "paid"), psid("done", "claimed")],
      returns: [ret("file", "ready"), ret("done", "filed")],
      period: "2026-09",
      now,
    });
    expect(stageOf(rows, "post")).toBe("post");
    expect(stageOf(rows, "pay")).toBe("pay");
    expect(stageOf(rows, "file")).toBe("file");
    expect(stageOf(rows, "done")).toBe("done");
  });

  it("flags a client that cannot post yet, but only when nothing more urgent is waiting", () => {
    const rows = buildWorkQueue({
      clients: [client("bare", { posToken: "", posId: "" }), client("bareFailed", { posToken: "" })],
      openInvoices: [invoice("bareFailed", "failed")],
      psids: [],
      returns: [],
      period: "2026-09",
      now,
    });
    expect(stageOf(rows, "bare")).toBe("setup");
    expect(stageOf(rows, "bareFailed")).toBe("fix");
    expect(rows.find((row) => row.client.id === "bare")?.setupGaps.length).toBeGreaterThan(0);
  });

  it("ignores archived clients and PSIDs or returns from another period", () => {
    const rows = buildWorkQueue({
      clients: [client("old", { archived: true }), client("live")],
      openInvoices: [],
      psids: [psid("live", "generated", "2026-08")],
      returns: [ret("live", "filed", "2026-08")],
      period: "2026-09",
      now,
    });
    expect(rows.map((row) => row.client.id)).toEqual(["live"]);
    expect(rows[0]?.psidOpen).toBe(0);
    expect(rows[0]?.returnStatus).toBe("open");
    expect(rows[0]?.stage).toBe("file");
  });

  it("sorts the most urgent stage first and keeps names alphabetical inside a stage", () => {
    const rows = buildWorkQueue({
      clients: [client("z"), client("m"), client("a"), client("f")],
      openInvoices: [invoice("m", "failed"), invoice("z", "draft"), invoice("a", "draft")],
      psids: [],
      returns: [ret("f", "filed")],
      period: "2026-09",
      now,
    });
    expect(rows.map((row) => row.client.id)).toEqual(["m", "a", "z", "f"]);
  });

  it("reports days left to the 15th and 18th, negative once overdue", () => {
    const early = buildWorkQueue({ clients: [client("a")], openInvoices: [], psids: [], returns: [], period: "2026-09", now });
    expect(early[0]?.daysToPayment).toBe(5);
    expect(early[0]?.daysToReturn).toBe(8);
    const late = buildWorkQueue({
      clients: [client("a")],
      openInvoices: [],
      psids: [],
      returns: [],
      period: "2026-09",
      now: new Date(2026, 9, 20),
    });
    expect(late[0]?.daysToReturn).toBe(-2);
    expect(late[0]?.overdue).toBe(true);
  });

  it("stays linear in clients: 500 clients and 5,000 open invoices build quickly", () => {
    const clients = Array.from({ length: 500 }, (_, index) => client(`c${index}`));
    const openInvoices = Array.from({ length: 5000 }, (_, index) => invoice(`c${index % 500}`, "draft", `i${index}`));
    const started = performance.now();
    const rows = buildWorkQueue({ clients, openInvoices, psids: [], returns: [], period: "2026-09", now });
    expect(rows).toHaveLength(500);
    expect(rows[0]?.toPost).toBe(10);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe("filterWorkQueue and stageCounts", () => {
  const rows = buildWorkQueue({
    clients: [client("a", { businessName: "Ahmad Foods", pntn: "1111111-1" }), client("b", { businessName: "Bilal Salon", pntn: "2222222-2" })],
    openInvoices: [invoice("a", "failed")],
    psids: [],
    returns: [ret("b", "filed")],
    period: "2026-09",
    now,
  });

  it("counts clients per stage", () => {
    expect(stageCounts(rows)).toMatchObject({ fix: 1, done: 1, post: 0 });
  });

  it("filters by stage and by name or PNTN text", () => {
    expect(filterWorkQueue(rows, { stage: "fix", text: "" }).map((row) => row.client.id)).toEqual(["a"]);
    expect(filterWorkQueue(rows, { stage: "all", text: "bilal" }).map((row) => row.client.id)).toEqual(["b"]);
    expect(filterWorkQueue(rows, { stage: "all", text: "2222222" }).map((row) => row.client.id)).toEqual(["b"]);
    expect(filterWorkQueue(rows, { stage: "open", text: "" }).map((row) => row.client.id)).toEqual(["a"]);
  });
});
