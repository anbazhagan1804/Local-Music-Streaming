import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { deduplicateTracksByContentHash } from "../src/services/trackDeduplication";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      artist TEXT,
      album TEXT,
      album_artist TEXT,
      genre TEXT,
      year INTEGER,
      duration REAL,
      track_number INTEGER,
      disc_number INTEGER,
      format TEXT,
      bitrate INTEGER,
      sample_rate INTEGER,
      size INTEGER NOT NULL DEFAULT 0,
      mtime INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE favorites (
      user_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, track_id)
    );

    CREATE TABLE playlist_tracks (
      playlist_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (playlist_id, track_id)
    );
  `);

  return db;
}

describe("deduplicateTracksByContentHash", () => {
  it("keeps one track row per content hash and merges references", () => {
    const db = createTestDb();

    const canonicalInsert = db
      .prepare("INSERT INTO tracks (file_path, title, size, mtime, content_hash) VALUES (?, ?, ?, ?, ?)")
      .run("uploads/a.mp3", "Song A", 100, 1, "hash-1");
    const duplicateInsert = db
      .prepare("INSERT INTO tracks (file_path, title, size, mtime, content_hash) VALUES (?, ?, ?, ?, ?)")
      .run("uploads/b.mp3", "Song A", 100, 1, "hash-1");
    const duplicateTrackId = Number(duplicateInsert.lastInsertRowid);
    const canonicalTrackId = Number(canonicalInsert.lastInsertRowid);

    db.prepare("INSERT INTO favorites (user_id, track_id) VALUES (?, ?)").run(1, duplicateTrackId);
    db.prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)").run(5, duplicateTrackId, 2);

    const deduplicated = deduplicateTracksByContentHash(db as never, new Set(["uploads/a.mp3", "uploads/b.mp3"]));

    expect(deduplicated).toBe(1);

    const tracks = db.prepare("SELECT id, file_path FROM tracks WHERE content_hash = 'hash-1' ORDER BY id ASC").all() as Array<{
      id: number;
      file_path: string;
    }>;
    expect(tracks).toEqual([{ id: canonicalTrackId, file_path: "uploads/a.mp3" }]);

    const favorite = db.prepare("SELECT user_id, track_id FROM favorites").get() as { user_id: number; track_id: number };
    expect(favorite).toEqual({ user_id: 1, track_id: canonicalTrackId });

    const playlistTrack = db
      .prepare("SELECT playlist_id, track_id, position FROM playlist_tracks")
      .get() as { playlist_id: number; track_id: number; position: number };
    expect(playlistTrack).toEqual({ playlist_id: 5, track_id: canonicalTrackId, position: 2 });

    db.close();
  });
});
