/**
 * PRA PostData outcome interpretation (same rules as the desk).
 * No tokens, no logging of secrets.
 */

export type PraOutcomeKind =
  | "success"
  | "already_exists"
  | "auth"
  | "ip"
  | "validation"
  | "rejected"
  | "unknown";

export type PraPostResult = {
  ok: boolean;
  fiscalNumber: string;
  code: string;
  message: string;
  alreadyExists: boolean;
  kind: PraOutcomeKind;
  raw: string;
};

const SUCCESS = new Set(["100", "00"]);

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function isRealFiscal(value: string): boolean {
  const t = value.trim();
  if (!t || /^not\s*available$/i.test(t)) return false;
  return /^\d{10,}$/.test(t.replace(/\s/g, ""));
}

function isDuplicateText(blob: string): boolean {
  return /usin\s+already\s+exists|already\s+exist|duplicate\s+usin/i.test(blob);
}

function readJsonStringOrInt(raw: string, keys: readonly string[]): string {
  for (const key of keys) {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*(?:"([^"]*)"|(-?\\d+))`, "i"));
    if (match) return (match[1] ?? match[2] ?? "").trim();
  }
  return "";
}

function readPraErrors(record: Record<string, unknown>): string {
  const errors = record.Errors ?? record.errors;
  if (!errors || errors === "null") return "";
  if (typeof errors === "string") return errors.trim();
  if (!Array.isArray(errors)) return "";
  return errors
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        return asText(row.Error ?? row.error ?? row.Message ?? row.message ?? row.Response);
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

export function parsePraBody(raw: string): { code: string; message: string; fiscalNumber: string } {
  const fiscalFromRaw = readJsonStringOrInt(raw, ["InvoiceNumber", "invoiceNumber"]);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { code: "", message: raw, fiscalNumber: fiscalFromRaw };
    }
    const record = parsed as Record<string, unknown>;
    const code = asText(record.Code ?? record.code);
    const errors = readPraErrors(record);
    const response = asText(record.Response ?? record.response ?? record.Message ?? record.message);
    const message = [response, errors].filter(Boolean).join(" ") || raw;
    const fiscalNumber = fiscalFromRaw || asText(record.InvoiceNumber ?? record.invoiceNumber);
    return { code, message, fiscalNumber };
  } catch {
    return { code: "", message: raw, fiscalNumber: fiscalFromRaw };
  }
}

export function isPraTransportBody(raw: string, contentType = ""): boolean {
  if (/html/i.test(contentType)) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return false;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

/** Timeouts, 5xx, HTML → unknown (not a safe auto-retry). */
export function isAmbiguousPraTransport(status: number, raw: string, contentType = ""): boolean {
  if (status === 0) return true;
  if (status === 404 || status === 502 || status === 503 || status === 504) return true;
  if (status >= 500) return true;
  return !isPraTransportBody(raw, contentType);
}

/**
 * Connection refused / DNS — proven not to have reached PRA → safe to leave pending for retry.
 * Timeouts are NOT included (request may have reached PRA).
 */
export function isProvenUnreachableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|connection refused|dns/i.test(message);
}

export function mapPraOutcome(
  parsed: { code: string; message: string; fiscalNumber: string },
  httpStatus: number,
): Omit<PraPostResult, "raw"> {
  const code = parsed.code.trim();
  const message = parsed.message.trim();
  const fiscalNumber = parsed.fiscalNumber.trim();
  const blob = `${code} ${message} ${fiscalNumber}`.trim();
  const duplicate = isDuplicateText(blob);
  const successCode = SUCCESS.has(code);
  const realFiscal = isRealFiscal(fiscalNumber);

  if (successCode) {
    return {
      ok: true,
      fiscalNumber,
      code,
      message: message || "Posted",
      alreadyExists: duplicate,
      kind: duplicate ? "already_exists" : "success",
    };
  }
  if (duplicate) {
    return {
      ok: false,
      fiscalNumber: realFiscal ? fiscalNumber : "",
      code,
      message: message || "USIN already exists",
      alreadyExists: true,
      kind: "already_exists",
    };
  }
  const lower = blob.toLowerCase();
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    /unauthorized|invalid token|invalid authorization|bearer/.test(lower)
  ) {
    return {
      ok: false,
      fiscalNumber: "",
      code,
      message: message || (httpStatus ? `HTTP ${httpStatus}` : "Auth refused"),
      alreadyExists: false,
      kind: "auth",
    };
  }
  if (/whitelist|white list|not allowed|server ip/.test(lower)) {
    return {
      ok: false,
      fiscalNumber: "",
      code,
      message: message || "IP not allowed",
      alreadyExists: false,
      kind: "ip",
    };
  }
  if (
    httpStatus === 400 ||
    /invalid invoice|validation|required field|invalid data|pct|datetime|usin is required/.test(lower)
  ) {
    return {
      ok: false,
      fiscalNumber: "",
      code,
      message: message || "Validation rejected",
      alreadyExists: false,
      kind: "validation",
    };
  }
  return {
    ok: false,
    fiscalNumber: "",
    code,
    message: message || (httpStatus ? `HTTP ${httpStatus}` : "PRA rejected"),
    alreadyExists: false,
    kind: "rejected",
  };
}

export function interpretPraPost(raw: string, httpStatus: number): PraPostResult {
  if (isAmbiguousPraTransport(httpStatus, raw)) {
    return {
      ok: false,
      fiscalNumber: "",
      code: "",
      message: "No clear answer from PRA (timeout or gateway). Check IRIS before posting again.",
      alreadyExists: false,
      kind: "unknown",
      raw,
    };
  }
  const parsed = parsePraBody(raw);
  return { ...mapPraOutcome(parsed, httpStatus), raw };
}
