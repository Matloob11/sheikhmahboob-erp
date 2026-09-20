/** Shared “unsaved work” gate for route changes, client switch, and period switch. */

export type LeaveDecision = "allow" | "block";

type LeaveAsk = () => Promise<boolean>;

let ask: LeaveAsk | null = null;

export function registerLeaveAsk(next: LeaveAsk | null): void {
  ask = next;
}

/** Returns true when the navigation/switch may proceed. */
export async function requestLeave(): Promise<boolean> {
  if (!ask) return true;
  return ask();
}

export function leaveDecision(dirty: boolean, confirmed: boolean): LeaveDecision {
  if (!dirty) return "allow";
  return confirmed ? "allow" : "block";
}
