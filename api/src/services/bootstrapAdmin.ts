import { DbClient } from "../db";
import { config } from "../config";
import { hashPassword } from "../utils/password";

export async function ensureAdminUser(db: DbClient): Promise<void> {
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    return;
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(config.ADMIN_EMAIL) as { id: number } | undefined;
  if (existing) {
    return;
  }

  const passwordHash = await hashPassword(config.ADMIN_PASSWORD);
  db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')").run(config.ADMIN_EMAIL, passwordHash);
  console.log(`[bootstrap] Admin user created: ${config.ADMIN_EMAIL}`);
}
