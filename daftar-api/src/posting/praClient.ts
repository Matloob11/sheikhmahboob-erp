import { createHash, randomUUID } from "node:crypto";
import { env } from "../env.js";

export type PraFetchResult = {
  status: number;
  raw: string;
  contentType: string;
};

export type PraFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<PraFetchResult>;

let injectedFetch: PraFetch | null = null;

/** Test hook — inject a fake PRA transport. */
export function setPraFetchForTests(fn: PraFetch | null): void {
  injectedFetch = fn;
}

export function praPostUrl(environment: "sandbox" | "production"): string {
  if (env.praPostUrlOverride) return env.praPostUrlOverride;
  return environment === "production"
    ? "https://ims.pral.com.pk/ims/production/api/Live/PostData"
    : "https://ims.pral.com.pk/ims/sandbox/api/Live/PostData";
}

export function hashPayload(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export async function sendToPra(options: {
  environment: "sandbox" | "production";
  token: string;
  body: string;
  timeoutMs?: number;
}): Promise<PraFetchResult> {
  const url = praPostUrl(options.environment);
  const timeoutMs = options.timeoutMs ?? env.praFetchMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${options.token}`,
  };
  try {
    if (injectedFetch) {
      return await injectedFetch(url, {
        method: "POST",
        headers,
        body: options.body,
        signal: controller.signal,
      });
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: options.body,
      signal: controller.signal,
    });
    const raw = await response.text();
    return {
      status: response.status,
      raw,
      contentType: response.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
