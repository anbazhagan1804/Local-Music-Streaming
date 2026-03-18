import { DbClient } from "../db";

type TrackHashRow = {
  id: number;
  file_path: string;
  content_hash: string;
};

type PlaylistTrackRow = {
  playlist_id: number;
  position: number;
  created_at: string;
};

function pickCanonicalTrack(rows: TrackHashRow[], activeRelativePaths: Set<string>): TrackHashRow {
  const activeRows = rows.filter((row) => activeRelativePaths.has(row.file_path));
  return (activeRows[0] || rows[0]) as TrackHashRow;
}

export function deduplicateTracksByContentHash(db: DbClient, activeRelativePaths: Set<string>): number {
  const duplicateHashes = db
    .prepare(
      `
        SELECT content_hash
        FROM tracks
        WHERE content_hash IS NOT NULL AND content_hash != ''
        GROUP BY content_hash
        HAVING COUNT(*) > 1
      `
    )
    .all() as Array<{ content_hash: string }>;

  if (duplicateHashes.length === 0) {
    return 0;
  }

  const getTracksByHash = db.prepare(
    `
      SELECT id, file_path, content_hash
      FROM tracks
      WHERE content_hash = ?
      ORDER BY id ASC
    `
  );
  const moveFavorites = db.prepare(
    `
      INSERT OR IGNORE INTO favorites (user_id, track_id, created_at)
      SELECT user_id, ?, created_at
      FROM favorites
      WHERE track_id = ?
    `
  );
  const getPlaylistTracks = db.prepare(
    `
      SELECT playlist_id, position, created_at
      FROM playlist_tracks
      WHERE track_id = ?
      ORDER BY playlist_id ASC, position ASC
    `
  );
  const movePlaylistTrack = db.prepare(
    `
      INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, created_at)
      VALUES (?, ?, ?, ?)
    `
  );
  const deleteFavoritesForTrack = db.prepare("DELETE FROM favorites WHERE track_id = ?");
  const deletePlaylistTracksForTrack = db.prepare("DELETE FROM playlist_tracks WHERE track_id = ?");
  const deleteTrack = db.prepare("DELETE FROM tracks WHERE id = ?");

  const mergeTrack = db.transaction((canonicalId: number, duplicateId: number) => {
    moveFavorites.run(canonicalId, duplicateId);

    const playlistRows = getPlaylistTracks.all(duplicateId) as PlaylistTrackRow[];
    for (const row of playlistRows) {
      movePlaylistTrack.run(row.playlist_id, canonicalId, row.position, row.created_at);
    }

    deleteFavoritesForTrack.run(duplicateId);
    deletePlaylistTracksForTrack.run(duplicateId);
    deleteTrack.run(duplicateId);
  });

  let deduplicated = 0;

  for (const hashRow of duplicateHashes) {
    const rows = getTracksByHash.all(hashRow.content_hash) as TrackHashRow[];
    if (rows.length < 2) {
      continue;
    }

    const canonical = pickCanonicalTrack(rows, activeRelativePaths);
    for (const row of rows) {
      if (row.id === canonical.id) {
        continue;
      }

      mergeTrack(canonical.id, row.id);
      deduplicated += 1;
    }
  }

  return deduplicated;
}
