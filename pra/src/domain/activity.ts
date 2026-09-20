import type { DeskEvent } from "../types";

const TOKENISH =
  /authorization|bearer\s+[a-z0-9._-]+|posToken|[a-f0-9]{40,}|[A-Za-z0-9+/]{40,}={0,2}/gi;

export function scrubActivityText(text: string): string {
  if (!text) return "";
  return text
    .replace(/authorization\s*:?\s*bearer\s+\S+/gi, "[redacted]")
    .replace(/posToken\b\s*\S*/gi, "[redacted]")
    .replace(TOKENISH, "[redacted]");
}

export function sanitizeActivityRows(events: ReadonlyArray<DeskEvent>): Array<{
  createdAt: string;
  kind: string;
  title: string;
  detail: string;
  clientId: string;
}> {
  return events.map((event) => ({
    createdAt: new Date(event.createdAt).toISOString(),
    kind: event.kind,
    title: scrubActivityText(event.title),
    detail: scrubActivityText(event.detail),
    clientId: event.clientId ?? "",
  }));
}
