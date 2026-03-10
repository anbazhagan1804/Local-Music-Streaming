import fs from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
import { DbClient } from "../db";
import { isSupportedAudioExtension } from "../utils/audioExtensions";
import { normalizeRelativePath } from "../utils/pathSafety";

export type ScanResult = {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  errors: Array<{ file: string; error: string }>;
};

async function walkMusicFiles(root: string): Promise<string[]> {
  const stack = [root];
  const files: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (isSupportedAudioExtension(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export async function scanLibrary(db: DbClient, musicDir: string): Promise<ScanResult> {
  const result: ScanResult = {
    scanned: 0,
    added: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    errors: []
  };

  const files = await walkMusicFiles(musicDir);
  const seenRelativePaths = new Set<string>();

  const getTrackByPath = db.prepare("SELECT id, mtime, size FROM tracks WHERE file_path = ?");
  const insertTrack = db.prepare(`
    INSERT INTO tracks (
      file_path, title, artist, album, album_artist, genre, year, duration,
      track_number, disc_number, format, bitrate, sample_rate, size, mtime, updated_at
    ) VALUES (
      @file_path, @title, @artist, @album, @album_artist, @genre, @year, @duration,
      @track_number, @disc_number, @format, @bitrate, @sample_rate, @size, @mtime, CURRENT_TIMESTAMP
    )
  `);
  const updateTrack = db.prepare(`
    UPDATE tracks
    SET title = @title,
        artist = @artist,
        album = @album,
        album_artist = @album_artist,
        genre = @genre,
        year = @year,
        duration = @duration,
        track_number = @track_number,
        disc_number = @disc_number,
        format = @format,
        bitrate = @bitrate,
        sample_rate = @sample_rate,
        size = @size,
        mtime = @mtime,
        updated_at = CURRENT_TIMESTAMP
    WHERE file_path = @file_path
  `);

  for (const absolutePath of files) {
    result.scanned += 1;
    const relativePath = normalizeRelativePath(path.relative(musicDir, absolutePath));
    seenRelativePaths.add(relativePath);

    try {
      const stats = await fs.stat(absolutePath);
      const existing = getTrackByPath.get(relativePath) as { id: number; mtime: number; size: number } | undefined;

      if (existing && existing.mtime === Math.floor(stats.mtimeMs) && existing.size === stats.size) {
        result.skipped += 1;
        continue;
      }

      let metadata;
      try {
        metadata = await parseFile(absolutePath, { duration: true, skipCovers: true });
      } catch {
        metadata = null;
      }

      const common = metadata?.common;
      const format = metadata?.format;
      const titleFallback = path.basename(absolutePath, path.extname(absolutePath));

      const payload = {
        file_path: relativePath,
        title: common?.title?.trim() || titleFallback,
        artist: common?.artist?.trim() || "Unknown Artist",
        album: common?.album?.trim() || "Unknown Album",
        album_artist: common?.albumartist?.trim() || common?.artist?.trim() || "Unknown Artist",
        genre: common?.genre?.[0]?.trim() || null,
        year: common?.year || null,
        duration: format?.duration || null,
        track_number: common?.track?.no || null,
        disc_number: common?.disk?.no || null,
        format: format?.container || path.extname(absolutePath).slice(1),
        bitrate: format?.bitrate || null,
        sample_rate: format?.sampleRate || null,
        size: stats.size,
        mtime: Math.floor(stats.mtimeMs)
      };

      if (existing) {
        updateTrack.run(payload);
        result.updated += 1;
      } else {
        insertTrack.run(payload);
        result.added += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scanner error";
      result.errors.push({ file: relativePath, error: message });
    }
  }

  const existingTracks = db.prepare("SELECT file_path FROM tracks").all() as Array<{ file_path: string }>;
  const stalePaths = existingTracks.filter((row) => !seenRelativePaths.has(row.file_path));

  const deleteTrack = db.prepare("DELETE FROM tracks WHERE file_path = ?");
  for (const stale of stalePaths) {
    deleteTrack.run(stale.file_path);
    result.removed += 1;
  }

  return result;
}
