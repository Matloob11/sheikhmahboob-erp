export type BadgeTone =
  | "draft"
  | "validated"
  | "posted"
  | "failed"
  | "unknown"
  | "open"
  | "ready"
  | "filed"
  | "planned"
  | "generated"
  | "paid"
  | "claimed"
  | "sandbox"
  | "production";

export function Badge({ tone, children }: { tone: BadgeTone; children: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
