import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ClientPicker } from "./ClientPicker";
import { EmptyState } from "./EmptyState";
import { useDesk } from "../context/DeskContext";
import { sectionPath } from "../domain/nav";

export function NeedClient({
  title = "Select a client",
  body = "Invoices, annexes and PSIDs attach to one taxpayer at a time.",
  action,
}: {
  title?: string;
  body?: string;
  action?: ReactNode;
}) {
  const { clients, invoices, chooseClient } = useDesk();
  const active = clients.filter((row) => !row.archived);

  if (active.length === 0) {
    return (
      <EmptyState
        title={title}
        body={body}
        action={
          action ?? (
            <Link className="btn stamp" to={sectionPath("/clients")}>
              Add client
            </Link>
          )
        }
      />
    );
  }

  return (
    <ClientPicker
      title={title}
      body={body}
      clients={active}
      invoices={invoices}
      onSelect={(id) => void chooseClient(id)}
    />
  );
}
