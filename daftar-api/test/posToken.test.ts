import { describe, expect, it } from "vitest";
import {
  decryptPosToken,
  encryptPosToken,
  isEncryptedPosToken,
  sealPosTokenForStore,
} from "../src/crypto/posToken.js";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PLAIN = "live-pra-token-NEVER-IN-DUMP";

describe("posToken encryption", () => {
  it("encrypts so a plain dump cannot read the token", () => {
    const sealed = encryptPosToken(PLAIN, KEY);
    expect(isEncryptedPosToken(sealed)).toBe(true);
    expect(sealed.includes(PLAIN)).toBe(false);
    // Simulate a pg_dump line: the ciphertext blob must not contain plaintext.
    const fakeDump = `COPY clients (id, pos_token) FROM stdin;\nc1\t${sealed}\n\\.`;
    expect(fakeDump.includes(PLAIN)).toBe(false);
    expect(decryptPosToken(sealed, KEY)).toBe(PLAIN);
  });

  it("keeps existing ciphertext when incoming is blank", () => {
    const existing = encryptPosToken(PLAIN, KEY);
    const next = sealPosTokenForStore("", existing, KEY);
    expect(next).toBe(existing);
    expect(decryptPosToken(next, KEY)).toBe(PLAIN);
  });

  it("is idempotent on already-encrypted values", () => {
    const sealed = encryptPosToken(PLAIN, KEY);
    expect(encryptPosToken(sealed, KEY)).toBe(sealed);
  });
});
