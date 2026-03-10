import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db";

export async function favoriteRoutes(app: FastifyInstance): Promise<void> {
  app.get("/favorites", { preHandler: [app.authenticate] }, async (request) => {
    const rows = db
      .prepare(
        `
        SELECT t.*
        FROM favorites f
        JOIN tracks t ON t.id = f.track_id
        WHERE f.user_id = ?
        ORDER BY f.created_at DESC
      `
      )
      .all(request.user.id);

    return { items: rows };
  });

  app.post("/favorites/:trackId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const paramsSchema = z.object({ trackId: z.coerce.number().int().positive() });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid track id" });
    }

    const track = db.prepare("SELECT id FROM tracks WHERE id = ?").get(parsed.data.trackId) as { id: number } | undefined;
    if (!track) {
      return reply.code(404).send({ error: "Track not found" });
    }

    db.prepare("INSERT OR IGNORE INTO favorites (user_id, track_id) VALUES (?, ?)").run(request.user.id, parsed.data.trackId);
    return { ok: true };
  });

  app.delete("/favorites/:trackId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const paramsSchema = z.object({ trackId: z.coerce.number().int().positive() });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid track id" });
    }

    db.prepare("DELETE FROM favorites WHERE user_id = ? AND track_id = ?").run(request.user.id, parsed.data.trackId);
    return { ok: true };
  });
}
