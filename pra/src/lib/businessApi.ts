/**
 * Owner business-user management via /pra-api.
 */
import { apiBase } from "./apiSync";

function tokenOrThrow(): string {
  const t = localStorage.getItem("daftar.apiToken");
  if (!t) throw new Error("Not signed in to API.");
  return t;
}

export type BusinessRow = {
  id: string;
  email: string;
  role: string;
  disabled: boolean;
  clientId: string;
  createdAt: string;
};

export async function listBusinessUsers(): Promise<BusinessRow[]> {
  const res = await fetch(`${apiBase()}/business`, {
    headers: { Authorization: `Bearer ${tokenOrThrow()}` },
    credentials: "omit",
  });
  if (!res.ok) throw new Error(res.status === 403 ? "Owner only." : `List failed (${res.status})`);
  const body = (await res.json()) as { business: BusinessRow[] };
  return body.business ?? [];
}

export async function createBusinessUser(
  email: string,
  password: string,
  clientId: string,
): Promise<BusinessRow> {
  const res = await fetch(`${apiBase()}/business`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenOrThrow()}`,
    },
    credentials: "omit",
    body: JSON.stringify({ email, password, clientId }),
  });
  if (res.status === 409) throw new Error("That email already exists.");
  if (!res.ok) throw new Error(`Create failed (${res.status})`);
  return (await res.json()) as BusinessRow;
}

export async function resetBusinessPassword(userId: string, password: string): Promise<void> {
  const res = await fetch(`${apiBase()}/business/${encodeURIComponent(userId)}/reset-password`, {
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

export async function setBusinessDisabled(userId: string, disabled: boolean): Promise<void> {
  const res = await fetch(`${apiBase()}/business/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenOrThrow()}`,
    },
    credentials: "omit",
    body: JSON.stringify({ disabled }),
  });
  if (!res.ok) throw new Error(`Update failed (${res.status})`);
}
