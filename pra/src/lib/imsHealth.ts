export type ImsHealth = {
  ok: boolean;
  via: "proxy" | "remote" | "down";
  status: number;
  detail: string;
};

async function probe(url: string): Promise<{ status: number; ok: boolean }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    return { status: response.status, ok: response.status < 500 };
  } catch {
    return { status: 0, ok: false };
  } finally {
    window.clearTimeout(timer);
  }
}

/** Read-only check. Does not post an invoice. */
export async function checkImsHealth(): Promise<ImsHealth> {
  const proxy = await probe("/pra-ims/ims/sandbox/api/Live/PostData");
  if (proxy.ok) {
    return { ok: true, via: "proxy", status: proxy.status, detail: "VPS proxy reached PRA." };
  }
  const remote = await probe("https://ims.pral.com.pk/ims/sandbox/api/Live/PostData");
  if (remote.ok) {
    return {
      ok: true,
      via: "remote",
      status: remote.status,
      detail: "Proxy failed; browser can still reach PRA directly (CORS may block a live post).",
    };
  }
  return {
    ok: false,
    via: "down",
    status: proxy.status || remote.status,
    detail: "Neither /pra-ims nor ims.pral.com.pk answered. Check the network.",
  };
}
