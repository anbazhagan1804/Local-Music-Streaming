import { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config";
import { db } from "../db";
import { hashPassword, verifyPassword } from "../utils/password";

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    if (!config.ALLOW_REGISTRATION) {
      return reply.code(403).send({ error: "Registration is disabled" });
    }

    const parsed = authSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message || "Invalid payload" });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number } | undefined;
    if (existing) {
      return reply.code(409).send({ error: "User already exists" });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const insert = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'user')").run(email, passwordHash);

    const token = app.jwt.sign({ id: Number(insert.lastInsertRowid), email, role: "user" });
    return reply.code(201).send({ token, user: { id: Number(insert.lastInsertRowid), email, role: "user" } });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = authSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message || "Invalid payload" });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const user = db
      .prepare("SELECT id, email, password_hash, role FROM users WHERE email = ?")
      .get(email) as
      | {
          id: number;
          email: string;
          password_hash: string;
          role: "admin" | "user";
        }
      | undefined;

    if (!user) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const isValid = await verifyPassword(parsed.data.password, user.password_hash);
    if (!isValid) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const token = app.jwt.sign({ id: user.id, email: user.email, role: user.role });
    return { token, user: { id: user.id, email: user.email, role: user.role } };
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (request) => {
    return { user: request.user };
  });
}
