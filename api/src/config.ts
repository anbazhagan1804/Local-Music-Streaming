import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const boolFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  CORS_ORIGIN: z.string().default("*"),
  ALLOW_REGISTRATION: boolFromEnv.default(true),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  DATA_DIR: z.string().default(path.resolve(process.cwd(), "data")),
  MUSIC_DIR: z.string().default(path.resolve(process.cwd(), "music"))
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const cfg = parsed.data;

fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
if (!fs.existsSync(cfg.MUSIC_DIR)) {
  console.warn(`[config] MUSIC_DIR does not exist yet: ${cfg.MUSIC_DIR}`);
}

export const config = cfg;
