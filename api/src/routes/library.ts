import { FastifyInstance } from "fastify";
import { db } from "../db";
import { scanLibrary } from "../services/libraryScanner";
import { config } from "../config";

let scanInProgress = false;

export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/library/stats", { preHandler: [app.authenticate] }, async () => {
    const counts = db
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM tracks) AS tracks,
          (SELECT COUNT(DISTINCT artist) FROM tracks WHERE artist IS NOT NULL) AS artists,
          (SELECT COUNT(DISTINCT album) FROM tracks WHERE album IS NOT NULL) AS albums
      `
      )
      .get() as { tracks: number; artists: number; albums: number };

    const latestScan = db
      .prepare("SELECT * FROM scan_jobs ORDER BY id DESC LIMIT 1")
      .get() as
      | {
          id: number;
          started_at: string;
          finished_at: string | null;
          status: string;
          scanned_count: number;
          added_count: number;
          updated_count: number;
          removed_count: number;
          skipped_count: number;
          error_message: string | null;
        }
      | undefined;

    return { ...counts, latestScan: latestScan || null, scanInProgress };
  });

  app.post("/library/scan", { preHandler: [app.authenticate] }, async (request, reply) => {
    if (request.user.role !== "admin") {
      return reply.code(403).send({ error: "Only admin can trigger scans" });
    }

    if (scanInProgress) {
      return reply.code(409).send({ error: "Library scan already in progress" });
    }

    scanInProgress = true;
    const scanJobInsert = db.prepare("INSERT INTO scan_jobs (status) VALUES ('running')").run();
    const scanJobId = Number(scanJobInsert.lastInsertRowid);

    try {
      const result = await scanLibrary(db, config.MUSIC_DIR);

      db.prepare(
        `
          UPDATE scan_jobs
          SET status = 'completed',
              finished_at = CURRENT_TIMESTAMP,
              scanned_count = ?,
              added_count = ?,
              updated_count = ?,
              removed_count = ?,
              skipped_count = ?
          WHERE id = ?
        `
      ).run(result.scanned, result.added, result.updated, result.removed, result.skipped, scanJobId);

      return { jobId: scanJobId, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scan error";
      db.prepare(
        "UPDATE scan_jobs SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?"
      ).run(message, scanJobId);
      return reply.code(500).send({ error: message });
    } finally {
      scanInProgress = false;
    }
  });
}
