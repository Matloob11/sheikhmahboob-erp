import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { newId } from "../lib/ids";
import type { DeskEvent, EventKind } from "../types";

export async function logEvent(input: {
  kind: EventKind;
  title: string;
  detail?: string;
  clientId?: string;
}): Promise<void> {
  const event: DeskEvent = {
    id: newId("evt"),
    clientId: input.clientId,
    kind: input.kind,
    title: input.title,
    detail: input.detail ?? "",
    createdAt: Date.now(),
  };
  await db.events.add(event);
  notifyDb();
}
