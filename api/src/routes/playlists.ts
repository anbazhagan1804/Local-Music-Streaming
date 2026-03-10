import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db";

const createPlaylistSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

export async function playlistRoutes(app: FastifyInstance): Promise<void> {
  app.get("/playlists", { preHandler: [app.authenticate] }, async (request) => {
    const rows = db
      .prepare(
        `
        SELECT p.id, p.name, p.created_at, COUNT(pt.track_id) AS track_count
        FROM playlists p
        LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
        WHERE p.user_id = ?
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `
      )
      .all(request.user.id);

    return { items: rows };
  });

  app.post("/playlists", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = createPlaylistSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid playlist name" });
    }

    const insert = db.prepare("INSERT INTO playlists (user_id, name) VALUES (?, ?)").run(request.user.id, parsed.data.name);
    return reply.code(201).send({ id: Number(insert.lastInsertRowid), name: parsed.data.name });
  });

  app.delete("/playlists/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid playlist id" });
    }

    const deleted = db.prepare("DELETE FROM playlists WHERE id = ? AND user_id = ?").run(parsed.data.id, request.user.id);
    if (deleted.changes === 0) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    return { ok: true };
  });

  app.get("/playlists/:id/tracks", { preHandler: [app.authenticate] }, async (request, reply) => {
    const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid playlist id" });
    }

    const playlist = db
      .prepare("SELECT id, name FROM playlists WHERE id = ? AND user_id = ?")
      .get(parsed.data.id, request.user.id) as { id: number; name: string } | undefined;

    if (!playlist) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const tracks = db
      .prepare(
        `
        SELECT t.*, pt.position
        FROM playlist_tracks pt
        JOIN tracks t ON t.id = pt.track_id
        WHERE pt.playlist_id = ?
        ORDER BY pt.position ASC
      `
      )
      .all(parsed.data.id);

    return { playlist, items: tracks };
  });

  app.post("/playlists/:id/tracks", { preHandler: [app.authenticate] }, async (request, reply) => {
    const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
    const bodySchema = z.object({ trackId: z.coerce.number().int().positive() });

    const paramsParsed = paramsSchema.safeParse(request.params);
    const bodyParsed = bodySchema.safeParse(request.body);

    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({ error: "Invalid payload" });
    }

    const playlist = db
      .prepare("SELECT id FROM playlists WHERE id = ? AND user_id = ?")
      .get(paramsParsed.data.id, request.user.id) as { id: number } | undefined;

    if (!playlist) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    const track = db.prepare("SELECT id FROM tracks WHERE id = ?").get(bodyParsed.data.trackId) as { id: number } | undefined;
    if (!track) {
      return reply.code(404).send({ error: "Track not found" });
    }

    const row = db
      .prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM playlist_tracks WHERE playlist_id = ?")
      .get(paramsParsed.data.id) as { next_position: number };

    db.prepare("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)").run(
      paramsParsed.data.id,
      bodyParsed.data.trackId,
      row.next_position
    );

    return { ok: true };
  });

  app.delete("/playlists/:id/tracks/:trackId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const paramsSchema = z.object({
      id: z.coerce.number().int().positive(),
      trackId: z.coerce.number().int().positive()
    });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid payload" });
    }

    const playlist = db
      .prepare("SELECT id FROM playlists WHERE id = ? AND user_id = ?")
      .get(parsed.data.id, request.user.id) as { id: number } | undefined;

    if (!playlist) {
      return reply.code(404).send({ error: "Playlist not found" });
    }

    db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?").run(parsed.data.id, parsed.data.trackId);
    return { ok: true };
  });
}
