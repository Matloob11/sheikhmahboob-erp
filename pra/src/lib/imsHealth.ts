export type ImsHealth = {
  ok: boolean;
  via: "proxy" | "down";
  status: number;
  detail: string;
};

async function probe(url: string): Promise<{ status: number; reachable: boolean; missing: boolean }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    // 404 = path not allowed on the locked proxy. 405 / 502 = path exists and nginx answered.
    return {
      status: response.status,
      missing: response.status === 404,
      reachable: response.status === 405 || response.status === 502 || (response.status > 0 && response.status < 500 && response.status !== 404),
    };
  } catch {
    return { status: 0, reachable: false, missing: false };
  } finally {
    window.clearTimeout(timer);
  }
}

/** Read-only check through the same-origin proxy. Does not post an invoice. */
export async function checkImsHealth(): Promise<ImsHealth> {
  const proxy = await probe("/pra-ims/ims/sandbox/api/Live/PostData");
  if (proxy.missing) {
    return {
      ok: false,
      via: "down",
      status: 404,
      detail: "Proxy path missing. The desk can only talk to PRA through /pra-ims PostData.",
    };
  }
  if (proxy.reachable) {
    const detail =
      proxy.status === 502
        ? "Proxy reached the PRA path (502 until PRA whitelists this server)."
        : proxy.status === 405
          ? "Proxy reached PRA (GET not allowed — that is expected)."
          : "VPS proxy answered.";
    return { ok: true, via: "proxy", status: proxy.status, detail };
  }
  return {
    ok: false,
    via: "down",
    status: proxy.status,
    detail: "The /pra-ims link did not answer. Check the network or ask ops to reload nginx.",
  };
}
