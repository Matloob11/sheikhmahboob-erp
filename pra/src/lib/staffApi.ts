/**
 * Owner staff management via /pra-api.
 */
import { apiBase } from "./apiSync";

function tokenOrThrow(): string {
  const t = localStorage.getItem("daftar.apiToken");
  if (!t) throw new Error("Not signed in to API.");
  return t;
}

export type StaffRow = {
  id: string;
  email: string;
  role: string;
  disabled: boolean;
  createdAt: string;
};

export async function listStaff(): Promise<StaffRow[]> {
  const res = await fetch(`${apiBase()}/staff`, {
    headers: { Authorization: `Bearer ${tokenOrThrow()}` },
    credentials: "omit",
  });
  if (!res.ok) throw new Error(res.status === 403 ? "Owner only." : `List staff failed (${res.status})`);
  const body = (await res.json()) as { staff: StaffRow[] };
  return body.staff ?? [];
}

export async function createStaff(email: string, password: string): Promise<StaffRow> {
  const res = await fetch(`${apiBase()}/staff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenOrThrow()}`,
    },
    credentials: "omit",
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 409) throw new Error("That email already exists.");
  if (!res.ok) throw new Error(`Create staff failed (${res.status})`);
  return (await res.json()) as StaffRow;
}

export async function resetStaffPassword(userId: string, password: string): Promise<void> {
  const res = await fetch(`${apiBase()}/staff/${encodeURIComponent(userId)}/reset-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenOrThrow()}`,
    },
    credentials: "omit",
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(`Reset password failed (${res.status})`);
}

export async function setStaffDisabled(userId: string, disabled: boolean): Promise<void> {
  const res = await fetch(`${apiBase()}/staff/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenOrThrow()}`,
    },
    credentials: "omit",
    body: JSON.stringify({ disabled }),
  });
  if (!res.ok) throw new Error(`Update staff failed (${res.status})`);
}

export async function assignStaff(userId: string, clientId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/staff/assign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenOrThrow()}`,
    },
    credentials: "omit",
    body: JSON.stringify({ userId, clientId }),
  });
  if (!res.ok) throw new Error(`Assign failed (${res.status})`);
}

export async function unassignStaff(userId: string, clientId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/staff/unassign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenOrThrow()}`,
    },
    credentials: "omit",
    body: JSON.stringify({ userId, clientId }),
  });
  if (!res.ok) throw new Error(`Unassign failed (${res.status})`);
}

export async function listAssignments(): Promise<Array<{ client_id: string; user_id: string }>> {
  const res = await fetch(`${apiBase()}/staff/assignments`, {
    headers: { Authorization: `Bearer ${tokenOrThrow()}` },
    credentials: "omit",
  });
  if (!res.ok) throw new Error(`Assignments failed (${res.status})`);
  const body = (await res.json()) as { assignments: Array<{ client_id: string; user_id: string }> };
  return body.assignments ?? [];
}
