export function countdownLabel(days: number, event: string): string {
  if (days === 0) return `${event} is today`;
  if (days === 1) return `1 day to ${event}`;
  if (days > 1) return `${days} days to ${event}`;
  if (days === -1) return `${event} was yesterday`;
  return `${event} was ${Math.abs(days)} days ago`;
}

export function countdownTone(days: number): "ok" | "soon" | "late" {
  if (days < 0) return "late";
  if (days <= 3) return "soon";
  return "ok";
}
