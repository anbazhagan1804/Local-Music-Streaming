export type User = {
  id: number;
  email: string;
  role: "admin" | "user";
};

export type Track = {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number | null;
  track_number: number | null;
  is_favorite?: number;
};

export type Playlist = {
  id: number;
  name: string;
  created_at?: string;
  track_count?: number;
};

export type UploadResult = {
  uploadedCount: number;
  uploaded: Array<{ originalName: string; storedPath: string; bytes: number }>;
  skippedCount: number;
  skipped: Array<{ name: string; reason: string }>;
  scan:
    | {
        status: "completed";
        jobId: number;
        message: string;
      }
    | {
        status: "deferred" | "failed" | "skipped";
        message: string;
      };
};

const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers || undefined);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const hasBody = options.body !== undefined && options.body !== null;
  if (!isFormData && hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      // Keep fallback message.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  baseUrl: API_BASE,
  login(email: string, password: string) {
    return request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  register(email: string, password: string) {
    return request<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  me(token: string) {
    return request<{ user: User }>("/auth/me", { method: "GET" }, token);
  },
  getTracks(token: string, search = "") {
    const query = new URLSearchParams({ search, page: "1", limit: "200" });
    return request<{ items: Track[] }>(`/tracks?${query.toString()}`, { method: "GET" }, token);
  },
  getStats(token: string) {
    return request<{
      tracks: number;
      artists: number;
      albums: number;
      latestScan: {
        started_at: string;
        finished_at: string | null;
        status: string;
      } | null;
      scanInProgress: boolean;
    }>("/library/stats", { method: "GET" }, token);
  },
  scanLibrary(token: string) {
    return request<{ scanned: number; added: number; updated: number; removed: number; skipped: number; deduplicated: number }>(
      "/library/scan",
      { method: "POST" },
      token
    );
  },
  uploadTracks(token: string, files: File[]) {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file, file.name);
    }

    return request<UploadResult>(
      "/library/upload",
      {
        method: "POST",
        body: formData
      },
      token
    );
  },
  addFavorite(token: string, trackId: number) {
    return request<{ ok: boolean }>(`/favorites/${trackId}`, { method: "POST" }, token);
  },
  removeFavorite(token: string, trackId: number) {
    return request<{ ok: boolean }>(`/favorites/${trackId}`, { method: "DELETE" }, token);
  },
  getPlaylists(token: string) {
    return request<{ items: Playlist[] }>("/playlists", { method: "GET" }, token);
  },
  createPlaylist(token: string, name: string) {
    return request<Playlist>(
      "/playlists",
      {
        method: "POST",
        body: JSON.stringify({ name })
      },
      token
    );
  },
  deletePlaylist(token: string, playlistId: number) {
    return request<{ ok: boolean }>(`/playlists/${playlistId}`, { method: "DELETE" }, token);
  },
  getPlaylistTracks(token: string, playlistId: number) {
    return request<{ playlist: Playlist; items: Track[] }>(`/playlists/${playlistId}/tracks`, { method: "GET" }, token);
  },
  addTrackToPlaylist(token: string, playlistId: number, trackId: number) {
    return request<{ ok: boolean }>(
      `/playlists/${playlistId}/tracks`,
      {
        method: "POST",
        body: JSON.stringify({ trackId })
      },
      token
    );
  },
  removeTrackFromPlaylist(token: string, playlistId: number, trackId: number) {
    return request<{ ok: boolean }>(`/playlists/${playlistId}/tracks/${trackId}`, { method: "DELETE" }, token);
  }
};
