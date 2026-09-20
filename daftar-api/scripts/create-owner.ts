import { randomUUID } from "node:crypto";
import { pool } from "../src/db.js";
import { hashPassword } from "../src/auth/password.js";
import { writeAudit } from "../src/audit.js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const emailRaw = arg("--email");
  const password = arg("--password");
  if (!emailRaw || !password) {
    console.error("Usage: npm run create-owner -- --email you@example.com --password secret");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const email = emailRaw.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const existing = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);

  let userId: string;
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    await pool.query(
      `UPDATE users
       SET password_hash = $2, role = 'owner', failed_logins = 0, locked_until = NULL, updated_at = now()
       WHERE id = $1`,
      [userId, passwordHash],
    );
    console.log(`updated owner ${email}`);
  } else {
    userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'owner')`,
      [userId, email, passwordHash],
    );
    console.log(`created owner ${email}`);
  }

  await writeAudit(pool, {
    actorUserId: userId,
    kind: "auth.create_owner_cli",
    entityId: userId,
    detail: email,
  });
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
