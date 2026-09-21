import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env.js";
import { pool } from "./db.js";

async function main(): Promise<void> {
  const sqlDir = join(env.root, "src", "sql");
  const files = readdirSync(sqlDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const id = file;
    const existing = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id]);
    if (existing.rowCount) {
      console.log(`skip ${id}`);
      continue;
    }
    const sql = readFileSync(join(sqlDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
      await client.query("COMMIT");
      console.log(`applied ${id}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const { reencryptPlainPosTokens } = await import("./reencryptTokens.js");
  const sealed = await reencryptPlainPosTokens();
  console.log(`reencrypted_pos_tokens=${sealed}`);

  await pool.end();
  console.log("MIGRATE_OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
