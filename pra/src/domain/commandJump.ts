import type { Buyer, Client, Invoice } from "../types";

export const DESK_JUMP_ROUTES = [
  { path: "/", label: "Desk" },
  { path: "/invoices", label: "Invoices" },
  { path: "/invoices/new", label: "New invoice" },
  { path: "/pos", label: "POS sale" },
  { path: "/reports", label: "Reports" },
  { path: "/buyers", label: "Buyers" },
  { path: "/items", label: "Items" },
  { path: "/returns", label: "Returns" },
  { path: "/psid", label: "PSID" },
  { path: "/settings", label: "Settings" },
  { path: "/clients", label: "Clients" },
] as const;

export type JumpKind = "route" | "client" | "buyer" | "invoice";

export interface JumpHit {
  kind: JumpKind;
  path: string;
  label: string;
  hint: string;
  clientId?: string;
}

export function matchJumpHits(input: {
  query: string;
  routes?: ReadonlyArray<{ path: string; label: string }>;
  invoices?: ReadonlyArray<Invoice>;
  buyers?: ReadonlyArray<Buyer>;
  clients?: ReadonlyArray<Client>;
}): JumpHit[] {
  const needle = input.query.trim().toLowerCase();
  const routes = input.routes ?? DESK_JUMP_ROUTES;
  const hits: JumpHit[] = [];

  for (const row of routes) {
    if (!needle || row.label.toLowerCase().includes(needle) || row.path.includes(needle)) {
      hits.push({ kind: "route", path: row.path, label: row.label, hint: row.path });
    }
  }

  if (!needle) return hits;

  for (const client of input.clients ?? []) {
    if (client.archived) continue;
    const hay = `${client.businessName} ${client.pntn} ${client.ntn ?? ""} ${client.personName ?? ""}`.toLowerCase();
    if (hay.includes(needle)) {
      hits.push({
        kind: "client",
        path: "/clients",
        label: client.businessName,
        hint: client.pntn || client.ntn || client.personName || "No PNTN",
        clientId: client.id,
      });
    }
  }

  for (const buyer of input.buyers ?? []) {
    const hay = `${buyer.name} ${buyer.pntn} ${buyer.cnic}`.toLowerCase();
    if (!hay.includes(needle)) continue;
    hits.push({
      kind: "buyer",
      path: "/buyers",
      label: buyer.name,
      hint: buyer.pntn || buyer.cnic || "Buyer",
      clientId: buyer.clientId,
    });
  }

  const invoices = (input.invoices ?? [])
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 40);
  for (const invoice of invoices) {
    const hay = `${invoice.usin} ${invoice.fiscalNumber}`.toLowerCase();
    if (!hay.includes(needle)) continue;
    hits.push({
      kind: "invoice",
      path: `/invoices/${invoice.id}`,
      label: invoice.usin,
      hint: invoice.fiscalNumber || invoice.buyerName || invoice.status,
      clientId: invoice.clientId,
    });
    if (hits.filter((row) => row.kind === "invoice").length >= 20) break;
  }

  return hits.slice(0, 40);
}
