/**
 * One-shot: re-encrypt any legacy plaintext pos_token rows.
 * Safe to run repeatedly — already-encrypted values are left alone.
 */
import { pool } from "./db.js";
import { env } from "./env.js";
import { encryptPosToken, isEncryptedPosToken } from "./crypto/posToken.js";

export async function reencryptPlainPosTokens(): Promise<number> {
  const { rows } = await pool.query<{ id: string; pos_token: string }>(
    `SELECT id, pos_token FROM clients WHERE pos_token <> ''`,
  );
  let n = 0;
  for (const row of rows) {
    if (isEncryptedPosToken(row.pos_token)) continue;
    const sealed = encryptPosToken(row.pos_token, env.tokenEncryptionKey);
    await pool.query(`UPDATE clients SET pos_token = $1 WHERE id = $2`, [sealed, row.id]);
    n += 1;
  }
  return n;
}
