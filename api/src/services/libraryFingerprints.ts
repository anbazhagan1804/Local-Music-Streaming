import fs from "node:fs/promises";
import path from "node:path";
import { DbClient } from "../db";
import { hashFile } from "../utils/contentHash";
import { buildTrackIdentityKey } from "./trackIdentity";

type FileFingerprintRow = {
  file_path: string;
  size: number;
};

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function toAbsoluteMusicPath(musicDir: string, filePath: string): string {
  return path.join(musicDir, filePath.split("/").join(path.sep));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function registerFileFingerprint(db: DbClient, filePath: string, contentHash: string, size: number): void {
  db.prepare(
    `
      INSERT INTO file_fingerprints (file_path, content_hash, size, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(file_path) DO UPDATE SET
        content_hash = excluded.content_hash,
        size = excluded.size,
        updated_at = CURRENT_TIMESTAMP
    `
  ).run(filePath, contentHash, size);
}

export function removeFileFingerprint(db: DbClient, filePath: string): void {
  db.prepare("DELETE FROM file_fingerprints WHERE file_path = ?").run(filePath);
}

export async function findDuplicateLibraryFile(
  db: DbClient,
  musicDir: string,
  contentHash: string,
  fileSize: number,
  identityKey?: string | null
): Promise<{ file_path: string } | undefined> {
  const fingerprintRows = db
    .prepare("SELECT file_path, size FROM file_fingerprints WHERE content_hash = ? ORDER BY updated_at DESC")
    .all(contentHash) as FileFingerprintRow[];

  for (const row of fingerprintRows) {
    const absolutePath = toAbsoluteMusicPath(musicDir, row.file_path);
    if (await pathExists(absolutePath)) {
      return { file_path: row.file_path };
    }

    removeFileFingerprint(db, row.file_path);
  }

  const knownTrackedRows = db
    .prepare("SELECT file_path, size FROM tracks WHERE content_hash = ?")
    .all(contentHash) as FileFingerprintRow[];

  for (const row of knownTrackedRows) {
    const absolutePath = toAbsoluteMusicPath(musicDir, row.file_path);
    if (!(await pathExists(absolutePath))) {
      continue;
    }

    registerFileFingerprint(db, row.file_path, contentHash, row.size);
    return { file_path: row.file_path };
  }

  const tracksNeedingHashes = db
    .prepare("SELECT file_path, size FROM tracks WHERE size = ? AND (content_hash IS NULL OR content_hash = '')")
    .all(fileSize) as FileFingerprintRow[];

  const updateTrackHash = db.prepare("UPDATE tracks SET content_hash = ? WHERE file_path = ?");

  for (const row of tracksNeedingHashes) {
    const absolutePath = toAbsoluteMusicPath(musicDir, row.file_path);
    if (!(await pathExists(absolutePath))) {
      continue;
    }

    const existingHash = await hashFile(absolutePath);
    updateTrackHash.run(existingHash, row.file_path);
    registerFileFingerprint(db, row.file_path, existingHash, row.size);

    if (existingHash === contentHash) {
      return { file_path: row.file_path };
    }
  }

  const uploadRoot = path.join(musicDir, "uploads");
  if (await pathExists(uploadRoot)) {
    const stack = [uploadRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name !== ".incoming") {
            stack.push(path.join(current, entry.name));
          }
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const absolutePath = path.join(current, entry.name);
        const stats = await fs.stat(absolutePath);
        if (stats.size !== fileSize) {
          continue;
        }

        const existingHash = await hashFile(absolutePath);
        const relativePath = normalizeRelativePath(path.relative(musicDir, absolutePath));
        registerFileFingerprint(db, relativePath, existingHash, stats.size);

        if (existingHash === contentHash) {
          return { file_path: relativePath };
        }
      }
    }
  }

  if (identityKey) {
    const candidateRows = db
      .prepare("SELECT file_path, title, artist, duration FROM tracks")
      .all() as Array<{ file_path: string; title: string | null; artist: string | null; duration: number | null }>;

    for (const row of candidateRows) {
      const rowIdentityKey = buildTrackIdentityKey({
        title: row.title,
        artist: row.artist,
        duration: row.duration
      });

      if (rowIdentityKey !== identityKey) {
        continue;
      }

      const absolutePath = toAbsoluteMusicPath(musicDir, row.file_path);
      if (await pathExists(absolutePath)) {
        return { file_path: row.file_path };
      }
    }
  }

  return undefined;
}
