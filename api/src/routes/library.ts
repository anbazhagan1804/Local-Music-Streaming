import { MultipartFile } from "@fastify/multipart";
import { FastifyInstance } from "fastify";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { config } from "../config";
import { db } from "../db";
import { ScanResult, scanLibrary } from "../services/libraryScanner";
import { isSupportedAudioExtension } from "../utils/audioExtensions";

let scanInProgress = false;

function normalizePathForDb(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function sanitizeFilename(filename: string): string {
  const cleaned = path
    .basename(filename)
    .replace(/[^a-zA-Z0-9._()\-\s]/g, "_")
    .trim();

  return cleaned.length > 0 ? cleaned : `upload-${Date.now()}.bin`;
}

async function allocateAvailablePath(directory: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);

  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const candidate = path.join(directory, `${baseName}${suffix}${ext}`);

    try {
      await fsPromises.access(candidate);
      attempt += 1;
    } catch {
      return candidate;
    }
  }
}

async function runLibraryScan(): Promise<{ jobId: number; result: ScanResult }> {
  if (scanInProgress) {
    throw new Error("Library scan already in progress");
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

    return { jobId: scanJobId, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scan error";
    db.prepare(
      "UPDATE scan_jobs SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?"
    ).run(message, scanJobId);
    throw error;
  } finally {
    scanInProgress = false;
  }
}

async function writeUploadedFile(file: MultipartFile, uploadRoot: string): Promise<{
  originalName: string;
  storedPath: string;
  bytes: number;
}> {
  const originalName = file.filename || "unnamed-file";
  const safeName = sanitizeFilename(originalName);
  const destinationPath = await allocateAvailablePath(uploadRoot, safeName);

  try {
    await pipeline(file.file, fs.createWriteStream(destinationPath, { flags: "wx" }));
    const stat = await fsPromises.stat(destinationPath);

    return {
      originalName,
      storedPath: normalizePathForDb(path.relative(config.MUSIC_DIR, destinationPath)),
      bytes: stat.size
    };
  } catch (error) {
    try {
      await fsPromises.unlink(destinationPath);
    } catch {
      // Best effort cleanup.
    }

    const message = error instanceof Error ? error.message : "Unknown upload write error";
    throw new Error(`${originalName}: ${message}`);
  }
}

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

    try {
      const { jobId, result } = await runLibraryScan();
      return { jobId, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scan error";
      if (message.includes("already in progress")) {
        return reply.code(409).send({ error: message });
      }
      return reply.code(500).send({ error: message });
    }
  });

  app.post("/library/upload", { preHandler: [app.authenticate] }, async (request, reply) => {
    const contentType = request.headers["content-type"] || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return reply.code(400).send({ error: "Use multipart/form-data with one or more audio files" });
    }

    const uploadRoot = path.join(config.MUSIC_DIR, "uploads");
    await fsPromises.mkdir(uploadRoot, { recursive: true });

    const uploaded: Array<{ originalName: string; storedPath: string; bytes: number }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    try {
      for await (const file of request.files()) {
        const originalName = file.filename || "unnamed-file";

        if (!isSupportedAudioExtension(originalName)) {
          file.file.resume();
          skipped.push({
            name: originalName,
            reason: "Unsupported format. Allowed: .mp3, .flac, .m4a, .aac, .ogg, .wav, .opus"
          });
          continue;
        }

        try {
          const saved = await writeUploadedFile(file, uploadRoot);
          uploaded.push(saved);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown upload error";
          skipped.push({ name: originalName, reason: message });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid multipart upload";
      return reply.code(400).send({ error: message });
    }

    if (uploaded.length === 0) {
      return reply.code(400).send({ error: "No supported files were uploaded", skipped });
    }

    let scanResponse:
      | {
          status: "completed";
          jobId: number;
          result: ScanResult;
          message: string;
        }
      | {
          status: "deferred" | "failed";
          message: string;
        };

    if (scanInProgress) {
      scanResponse = {
        status: "deferred",
        message: "Files uploaded. A scan is already in progress, so new tracks will appear when it finishes."
      };
    } else {
      try {
        const scan = await runLibraryScan();
        scanResponse = {
          status: "completed",
          jobId: scan.jobId,
          result: scan.result,
          message: `Upload complete and library scanned (${scan.result.added} added, ${scan.result.updated} updated).`
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown scan error";
        scanResponse = {
          status: "failed",
          message: `Files uploaded but scan failed: ${message}`
        };
      }
    }

    return reply.code(scanResponse.status === "failed" ? 202 : 201).send({
      uploadedCount: uploaded.length,
      uploaded,
      skippedCount: skipped.length,
      skipped,
      scan: scanResponse
    });
  });
}
