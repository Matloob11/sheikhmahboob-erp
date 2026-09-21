/**
 * In-process fake PRA for M3 tests. Covers success, reject, duplicate, timeout,
 * 5xx, HTML, connection refused, and mid-send crash simulation.
 */
import { setPraFetchForTests, type PraFetch, type PraFetchResult } from "../src/posting/praClient.js";

export type FakePraMode =
  | "code_100"
  | "code_00"
  | "reject"
  | "duplicate_usin"
  | "timeout"
  | "http_500"
  | "html"
  | "refused"
  | "crash_mid_send";

let mode: FakePraMode = "code_100";
let callCount = 0;
let crashOnce = false;

export function setFakePraMode(next: FakePraMode): void {
  mode = next;
  callCount = 0;
  crashOnce = next === "crash_mid_send";
}

export function fakePraCallCount(): number {
  return callCount;
}

const fakeFetch: PraFetch = async (_url, init) => {
  callCount += 1;
  if (init.signal.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }

  if (mode === "refused") {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:9");
    (err as NodeJS.ErrnoException).code = "ECONNREFUSED";
    throw err;
  }

  if (mode === "timeout") {
    await new Promise<void>((_resolve, reject) => {
      const onAbort = () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      };
      if (init.signal.aborted) {
        onAbort();
        return;
      }
      init.signal.addEventListener("abort", onAbort, { once: true });
      // Never resolve — wait for abort from timeout
    });
  }

  if (mode === "crash_mid_send" && crashOnce) {
    crashOnce = false;
    // Simulate process crash after claim: leave row in sending; test will call recover.
    throw new Error("SIMULATED_WORKER_CRASH");
  }

  const responses: Record<string, PraFetchResult> = {
    code_100: {
      status: 200,
      contentType: "application/json",
      raw: JSON.stringify({ Code: "100", InvoiceNumber: "123456789012345678", Response: "Posted" }),
    },
    code_00: {
      status: 200,
      contentType: "application/json",
      raw: JSON.stringify({ Code: "00", InvoiceNumber: "987654321098765432", Response: "OK" }),
    },
    reject: {
      status: 200,
      contentType: "application/json",
      raw: JSON.stringify({ Code: "201", Response: "Invalid PCT code", Errors: ["PCT"] }),
    },
    duplicate_usin: {
      status: 200,
      contentType: "application/json",
      raw: JSON.stringify({ Code: "110", Response: "USIN already exists" }),
    },
    http_500: {
      status: 500,
      contentType: "text/plain",
      raw: "Internal Server Error",
    },
    html: {
      status: 200,
      contentType: "text/html",
      raw: "<!DOCTYPE html><html><body>gateway</body></html>",
    },
    crash_mid_send: {
      status: 200,
      contentType: "application/json",
      raw: JSON.stringify({ Code: "100", InvoiceNumber: "111111111111111111", Response: "Posted" }),
    },
  };

  return responses[mode] ?? responses.code_100!;
};

export function installFakePra(): void {
  setPraFetchForTests(fakeFetch);
}

export function uninstallFakePra(): void {
  setPraFetchForTests(null);
  mode = "code_100";
  callCount = 0;
}
