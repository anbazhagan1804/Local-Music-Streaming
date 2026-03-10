import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { FastifyInstance } from "fastify";
import mime from "mime-types";
import { z } from "zod";
import { config } from "../config";
import { db } from "../db";
import { safeResolveInsideRoot } from "../utils/pathSafety";

const listQuerySchema = z.object({
  search: z.string().trim().default(""),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

function parseRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return null;
  }

  const startText = match[1];
  const endText = match[2];

  let start = startText ? Number.parseInt(startText, 10) : 0;
  let end = endText ? Number.parseInt(endText, 10) : fileSize - 1;

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }

  if (startText && !endText) {
    end = fileSize - 1;
  }

  if (!startText && endText) {
    const suffixLength = Number.parseInt(endText, 10);
    if (suffixLength <= 0) {
      return null;
    }
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  }

  if (start > end || start >= fileSize) {
    return null;
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

export async function trackRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tracks", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query parameters" });
    }

    const { search, page, limit } = parsed.data;
    const offset = (page - 1) * limit;
    const like = `%${search}%`;

    const items = db
      .prepare(
        `
        SELECT
          t.id,
          t.file_path,
          t.title,
          t.artist,
          t.album,
          t.album_artist,
          t.genre,
          t.year,
          t.duration,
          t.track_number,
          t.disc_number,
          t.format,
          t.bitrate,
          t.sample_rate,
          CASE WHEN f.user_id IS NULL THEN 0 ELSE 1 END AS is_favorite
        FROM tracks t
        LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = @userId
        WHERE (
          @search = '' OR
          t.title LIKE @like OR
          t.artist LIKE @like OR
          t.album LIKE @like
        )
        ORDER BY COALESCE(t.artist, ''), COALESCE(t.album, ''), COALESCE(t.track_number, 0), t.title
        LIMIT @limit OFFSET @offset
      `
      )
      .all({ userId: request.user.id, search, like, limit, offset });

    const totalRow = db
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM tracks
        WHERE (
          @search = '' OR
          title LIKE @like OR
          artist LIKE @like OR
          album LIKE @like
        )
      `
      )
      .get({ search, like }) as { total: number };

    return {
      items,
      page,
      limit,
      total: totalRow.total,
      totalPages: Math.max(Math.ceil(totalRow.total / limit), 1)
    };
  });

  app.get("/tracks/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid track id" });
    }

    const row = db
      .prepare(
        `
        SELECT t.*, CASE WHEN f.user_id IS NULL THEN 0 ELSE 1 END AS is_favorite
        FROM tracks t
        LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = ?
        WHERE t.id = ?
      `
      )
      .get(request.user.id, parsed.data.id);

    if (!row) {
      return reply.code(404).send({ error: "Track not found" });
    }

    return row;
  });

  app.get("/tracks/:id/stream", { preHandler: [app.authenticate] }, async (request, reply) => {
    const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid track id" });
    }

    const row = db.prepare("SELECT id, file_path FROM tracks WHERE id = ?").get(parsed.data.id) as
      | { id: number; file_path: string }
      | undefined;

    if (!row) {
      return reply.code(404).send({ error: "Track not found" });
    }

    let fullPath: string;
    try {
      fullPath = safeResolveInsideRoot(config.MUSIC_DIR, row.file_path);
    } catch {
      return reply.code(400).send({ error: "Invalid track path" });
    }

    try {
      const stat = await fsPromises.stat(fullPath);
      const fileSize = stat.size;
      const mimeType = mime.lookup(fullPath) || "application/octet-stream";
      const range = request.headers.range;

      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Type", mimeType);
      reply.header("Cache-Control", "no-store");

      if (!range) {
        reply.header("Content-Length", fileSize.toString());
        return reply.send(fs.createReadStream(fullPath));
      }

      const parsedRange = parseRange(range, fileSize);
      if (!parsedRange) {
        reply.code(416);
        reply.header("Content-Range", `bytes */${fileSize}`);
        return reply.send({ error: "Invalid range" });
      }

      const chunkSize = parsedRange.end - parsedRange.start + 1;
      reply.code(206);
      reply.header("Content-Range", `bytes ${parsedRange.start}-${parsedRange.end}/${fileSize}`);
      reply.header("Content-Length", chunkSize.toString());

      return reply.send(fs.createReadStream(fullPath, { start: parsedRange.start, end: parsedRange.end }));
    } catch {
      return reply.code(404).send({ error: "File is missing from disk" });
    }
  });
}
