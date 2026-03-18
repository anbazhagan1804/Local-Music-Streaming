import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findDuplicateLibraryFile } from "../src/services/libraryFingerprints";
import { hashFile } from "../src/utils/contentHash";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT
    );

    CREATE TABLE file_fingerprints (
      file_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    })
  );
});

describe("findDuplicateLibraryFile", () => {
  it("blocks duplicates that were uploaded before the library scan ran", async () => {
    const db = createTestDb();
    const musicDir = await fs.mkdtemp(path.join(os.tmpdir(), "musicstream-registry-"));
    tempDirs.push(musicDir);

    const relativePath = "uploads/existing.mp3";
    const absolutePath = path.join(musicDir, "uploads", "existing.mp3");
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "same-audio-content");

    const contentHash = await hashFile(absolutePath);
    await expect(findDuplicateLibraryFile(db as never, musicDir, contentHash, Buffer.byteLength("same-audio-content"))).resolves.toEqual({
      file_path: relativePath
    });

    const fingerprint = db.prepare("SELECT content_hash FROM file_fingerprints WHERE file_path = ?").get(relativePath) as {
      content_hash: string;
    };
    expect(fingerprint.content_hash).toBe(contentHash);

    db.close();
  });

  it("backfills track hashes when older indexed tracks have no stored fingerprint yet", async () => {
    const db = createTestDb();
    const musicDir = await fs.mkdtemp(path.join(os.tmpdir(), "musicstream-track-backfill-"));
    tempDirs.push(musicDir);

    const relativePath = "library/song.mp3";
    const absolutePath = path.join(musicDir, "library", "song.mp3");
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "track-content");

    const size = Buffer.byteLength("track-content");
    db.prepare("INSERT INTO tracks (file_path, size, mtime, content_hash) VALUES (?, ?, ?, NULL)").run(relativePath, size, 1);

    const contentHash = await hashFile(absolutePath);
    await expect(findDuplicateLibraryFile(db as never, musicDir, contentHash, size)).resolves.toEqual({ file_path: relativePath });

    const updatedTrack = db.prepare("SELECT content_hash FROM tracks WHERE file_path = ?").get(relativePath) as {
      content_hash: string | null;
    };
    expect(updatedTrack.content_hash).toBe(contentHash);

    const fingerprint = db.prepare("SELECT content_hash FROM file_fingerprints WHERE file_path = ?").get(relativePath) as {
      content_hash: string;
    };
    expect(fingerprint.content_hash).toBe(contentHash);

    db.close();
  });
});
