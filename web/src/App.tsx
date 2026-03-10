import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, Playlist, Track, User } from "./lib/api";

const TOKEN_KEY = "musicstream_token";
const AUDIO_ACCEPT = ".mp3,.flac,.m4a,.aac,.ogg,.wav,.opus,audio/*";

type AuthMode = "login" | "register";

function formatDuration(seconds: number | null): string {
  if (!seconds || Number.isNaN(seconds)) {
    return "--:--";
  }

  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [search, setSearch] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<number | null>(null);
  const [activePlaylistTracks, setActivePlaylistTracks] = useState<Track[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);

  const [stats, setStats] = useState<{
    tracks: number;
    artists: number;
    albums: number;
    scanInProgress: boolean;
    latestScan: { status: string; finished_at: string | null } | null;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const streamUrl = useMemo(() => {
    if (!token || !currentTrack) {
      return "";
    }
    return `${api.baseUrl}/tracks/${currentTrack.id}/stream?token=${encodeURIComponent(token)}`;
  }, [token, currentTrack]);

  async function refreshStats(currentToken: string): Promise<void> {
    const statsResult = await api.getStats(currentToken);
    setStats(statsResult);
  }

  async function loadSession(tkn: string): Promise<void> {
    const [me, trackResult, playlistResult] = await Promise.all([
      api.me(tkn),
      api.getTracks(tkn, search),
      api.getPlaylists(tkn)
    ]);

    setUser(me.user);
    setTracks(trackResult.items);
    setPlaylists(playlistResult.items);
    await refreshStats(tkn);

    if (playlistResult.items.length > 0) {
      const firstId = playlistResult.items[0].id;
      setActivePlaylistId(firstId);
      const playlistTracks = await api.getPlaylistTracks(tkn, firstId);
      setActivePlaylistTracks(playlistTracks.items);
    } else {
      setActivePlaylistId(null);
      setActivePlaylistTracks([]);
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    loadSession(token)
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to initialize session");
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function refreshTracks(): Promise<void> {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const trackResult = await api.getTracks(token, search);
      setTracks(trackResult.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tracks");
    } finally {
      setLoading(false);
    }
  }

  async function refreshPlaylists(): Promise<void> {
    if (!token) {
      return;
    }

    const list = await api.getPlaylists(token);
    setPlaylists(list.items);

    if (activePlaylistId) {
      const found = list.items.some((p) => p.id === activePlaylistId);
      if (!found) {
        setActivePlaylistId(list.items[0]?.id ?? null);
      }
    } else if (list.items[0]) {
      setActivePlaylistId(list.items[0].id);
    }
  }

  useEffect(() => {
    if (!token || !activePlaylistId) {
      setActivePlaylistTracks([]);
      return;
    }

    let cancelled = false;
    api
      .getPlaylistTracks(token, activePlaylistId)
      .then((result) => {
        if (!cancelled) {
          setActivePlaylistTracks(result.items);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load playlist tracks");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, activePlaylistId]);

  async function onAuthSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const action = authMode === "login" ? api.login : api.register;
      const response = await action(email.trim(), password);
      localStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setEmail("");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function toggleFavorite(track: Track): Promise<void> {
    if (!token) {
      return;
    }

    try {
      if (track.is_favorite) {
        await api.removeFavorite(token, track.id);
      } else {
        await api.addFavorite(token, track.id);
      }

      setTracks((previous) =>
        previous.map((item) => (item.id === track.id ? { ...item, is_favorite: track.is_favorite ? 0 : 1 } : item))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update favorite");
    }
  }

  async function onCreatePlaylist(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) {
      return;
    }

    const name = newPlaylistName.trim();
    if (!name) {
      return;
    }

    try {
      await api.createPlaylist(token, name);
      setNewPlaylistName("");
      await refreshPlaylists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create playlist");
    }
  }

  async function onDeletePlaylist(playlistId: number): Promise<void> {
    if (!token) {
      return;
    }

    try {
      await api.deletePlaylist(token, playlistId);
      if (activePlaylistId === playlistId) {
        setActivePlaylistId(null);
      }
      await refreshPlaylists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete playlist");
    }
  }

  async function onAddTrackToActivePlaylist(trackId: number): Promise<void> {
    if (!token || !activePlaylistId) {
      return;
    }

    try {
      await api.addTrackToPlaylist(token, activePlaylistId, trackId);
      const playlistTracks = await api.getPlaylistTracks(token, activePlaylistId);
      setActivePlaylistTracks(playlistTracks.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add track to playlist");
    }
  }

  async function onRemoveTrackFromPlaylist(trackId: number): Promise<void> {
    if (!token || !activePlaylistId) {
      return;
    }

    try {
      await api.removeTrackFromPlaylist(token, activePlaylistId, trackId);
      const playlistTracks = await api.getPlaylistTracks(token, activePlaylistId);
      setActivePlaylistTracks(playlistTracks.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove track from playlist");
    }
  }

  async function onScanLibrary(): Promise<void> {
    if (!token) {
      return;
    }

    setScanMessage("Scanning library...");
    setError(null);

    try {
      const scan = await api.scanLibrary(token);
      await refreshTracks();
      await refreshStats(token);
      setScanMessage(
        `Scan complete: scanned ${scan.scanned}, added ${scan.added}, updated ${scan.updated}, removed ${scan.removed}, skipped ${scan.skipped}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Library scan failed");
      setScanMessage(null);
    }
  }

  function onFileSelection(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    setSelectedFiles(files);
    if (files.length === 0) {
      setUploadMessage(null);
    } else {
      setUploadMessage(`${files.length} file(s) selected`);
    }
  }

  async function onUploadMusic(): Promise<void> {
    if (!token || selectedFiles.length === 0) {
      return;
    }

    setUploading(true);
    setError(null);
    setUploadMessage("Uploading files...");

    try {
      const response = await api.uploadTracks(token, selectedFiles);
      await refreshTracks();
      await refreshStats(token);

      const skippedInfo = response.skippedCount > 0 ? ` ${response.skippedCount} file(s) skipped.` : "";
      setUploadMessage(`Uploaded ${response.uploadedCount} file(s). ${response.scan.message}${skippedInfo}`);

      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploadMessage(null);
    } finally {
      setUploading(false);
    }
  }

  function logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setTracks([]);
    setPlaylists([]);
    setActivePlaylistTracks([]);
    setCurrentTrack(null);
    setStats(null);
    setSelectedFiles([]);
    setError(null);
    setScanMessage(null);
    setUploadMessage(null);
  }

  if (!token || !user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>MusicStream</h1>
          <p>Self-hosted music streaming for your home server.</p>

          <div className="auth-toggle">
            <button
              className={authMode === "login" ? "active" : ""}
              type="button"
              onClick={() => setAuthMode("login")}
            >
              Login
            </button>
            <button
              className={authMode === "register" ? "active" : ""}
              type="button"
              onClick={() => setAuthMode("register")}
            >
              Register
            </button>
          </div>

          <form onSubmit={onAuthSubmit} className="auth-form">
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
              />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? "Please wait..." : authMode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>MusicStream</h1>
          <p>{user.email}</p>
        </div>
        <div className="toolbar">
          <input
            type="search"
            placeholder="Search tracks, artists, albums"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="button" onClick={() => void refreshTracks()} disabled={loading}>
            Search
          </button>
          <button type="button" onClick={() => void refreshTracks()} disabled={loading}>
            Refresh
          </button>
          {user.role === "admin" ? (
            <button type="button" onClick={() => void onScanLibrary()} disabled={loading || stats?.scanInProgress}>
              {stats?.scanInProgress ? "Scanning..." : "Scan Library"}
            </button>
          ) : null}
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            multiple
            accept={AUDIO_ACCEPT}
            onChange={onFileSelection}
            title="Choose music files"
          />
          <button type="button" onClick={() => void onUploadMusic()} disabled={uploading || selectedFiles.length === 0}>
            {uploading ? "Uploading..." : `Upload${selectedFiles.length > 0 ? ` (${selectedFiles.length})` : ""}`}
          </button>
          <button type="button" className="danger" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {stats ? (
        <section className="stats-grid">
          <div>
            <strong>{stats.tracks}</strong>
            <span>Tracks</span>
          </div>
          <div>
            <strong>{stats.artists}</strong>
            <span>Artists</span>
          </div>
          <div>
            <strong>{stats.albums}</strong>
            <span>Albums</span>
          </div>
          <div>
            <strong>{stats.latestScan?.status ?? "none"}</strong>
            <span>Last Scan</span>
          </div>
        </section>
      ) : null}

      {scanMessage ? <p className="success">{scanMessage}</p> : null}
      {uploadMessage ? <p className="success">{uploadMessage}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <section className="content-grid">
        <section className="panel tracks-panel">
          <h2>Library</h2>
          <ul className="track-list">
            {tracks.map((track) => (
              <li key={track.id}>
                <div className="track-meta">
                  <strong>{track.title}</strong>
                  <span>
                    {track.artist || "Unknown Artist"} {track.album ? `• ${track.album}` : ""}
                  </span>
                </div>
                <div className="track-actions">
                  <span>{formatDuration(track.duration)}</span>
                  <button type="button" onClick={() => setCurrentTrack(track)}>
                    Play
                  </button>
                  <button type="button" onClick={() => void toggleFavorite(track)}>
                    {track.is_favorite ? "Unfavorite" : "Favorite"}
                  </button>
                  <button type="button" onClick={() => void onAddTrackToActivePlaylist(track.id)} disabled={!activePlaylistId}>
                    Add to Playlist
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel playlists-panel">
          <h2>Playlists</h2>
          <form onSubmit={onCreatePlaylist} className="playlist-form">
            <input
              type="text"
              placeholder="New playlist name"
              value={newPlaylistName}
              onChange={(event) => setNewPlaylistName(event.target.value)}
              maxLength={120}
            />
            <button type="submit">Create</button>
          </form>

          <ul className="playlist-list">
            {playlists.map((playlist) => (
              <li key={playlist.id} className={playlist.id === activePlaylistId ? "active" : ""}>
                <button type="button" onClick={() => setActivePlaylistId(playlist.id)}>
                  {playlist.name} ({playlist.track_count ?? 0})
                </button>
                <button type="button" className="danger small" onClick={() => void onDeletePlaylist(playlist.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>

          <h3>Active Playlist Tracks</h3>
          <ul className="playlist-track-list">
            {activePlaylistTracks.map((track) => (
              <li key={track.id}>
                <span>{track.title}</span>
                <div>
                  <button type="button" onClick={() => setCurrentTrack(track)}>
                    Play
                  </button>
                  <button type="button" className="danger small" onClick={() => void onRemoveTrackFromPlaylist(track.id)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </section>

      <footer className="player">
        <div>
          <strong>{currentTrack?.title || "Nothing playing"}</strong>
          <span>{currentTrack?.artist || ""}</span>
        </div>
        <audio key={streamUrl} controls src={streamUrl} autoPlay />
      </footer>
    </main>
  );
}
