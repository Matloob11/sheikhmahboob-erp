/**
 * Encrypt POS tokens at rest (AES-256-GCM).
 * Wire format: enc:v1:<iv_b64>:<tag_b64>:<ct_b64>
 * Key: TOKEN_ENCRYPTION_KEY (32-byte hex or base64) — server .env only, never returned to clients.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function keyBytes(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const b64 = Buffer.from(trimmed, "base64");
    if (b64.length === 32) return b64;
  } catch {
    /* fall through */
  }
  // Deterministic stretch for local/dev misconfig — still 32 bytes; production must set a real key.
  return createHash("sha256").update(trimmed).digest();
}

export function isEncryptedPosToken(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptPosToken(plaintext: string, keyMaterial: string): string {
  if (!plaintext) return "";
  if (isEncryptedPosToken(plaintext)) return plaintext;
  const key = keyBytes(keyMaterial);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptPosToken(stored: string, keyMaterial: string): string {
  if (!stored) return "";
  if (!isEncryptedPosToken(stored)) return stored; // legacy plaintext until re-encrypted
  const body = stored.slice(PREFIX.length);
  const [ivB64, tagB64, ctB64] = body.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("corrupt_encrypted_pos_token");
  const key = keyBytes(keyMaterial);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Prepare a value for DB write: encrypt plaintext; keep existing ciphertext if incoming blank. */
export function sealPosTokenForStore(
  incomingPlainOrEmpty: string,
  existingStored: string | null | undefined,
  keyMaterial: string,
): string {
  if (incomingPlainOrEmpty) {
    return encryptPosToken(incomingPlainOrEmpty, keyMaterial);
  }
  if (existingStored) return existingStored;
  return "";
}

/** Peek plaintext for merge comparisons without exposing to API responses. */
export function peekPosTokenPlain(
  stored: string | null | undefined,
  keyMaterial: string,
): string {
  if (!stored) return "";
  return decryptPosToken(stored, keyMaterial);
}
