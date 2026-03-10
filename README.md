# MusicStream (Self-Hosted)

MusicStream is an open-source, locally hosted music streaming platform designed for home servers.
It includes:
- Fastify + TypeScript API (auth, metadata index, streaming, playlists, favorites)
- React + Vite web UI
- Docker Compose deployment (API + web)
- Local filesystem library scanner for music collections

## Project Overview

### Architecture

```mermaid
flowchart LR
  Browser["Web UI (React)"] -->|"API calls"| Nginx["Nginx Container"]
  Nginx --> API["Fastify API"]
  API --> DB[("SQLite (/data)")]
  API --> Library[("Mounted Music Library (/music)")]
```

### Key capabilities

- Email/password authentication with JWT
- Admin bootstrap account for first login
- Recursive scan of a mounted music folder
- Metadata extraction (`music-metadata`)
- Byte-range audio streaming endpoint (`206 Partial Content`)
- Browser upload flow for logged-in users (PC/mobile) with automatic post-upload scan
- Favorites and per-user playlists
- Home-server-friendly deployment with persistent data volume

## Project Structure

```text
.
+- api/
¦  +- src/
¦  ¦  +- routes/           # auth, tracks, favorites, playlists, library, health
¦  ¦  +- services/         # library scanner, admin bootstrap
¦  ¦  +- utils/            # password hashing, path safety
¦  ¦  +- types/            # Fastify type augmentations
¦  ¦  +- config.ts
¦  ¦  +- db.ts
¦  ¦  +- index.ts
¦  +- tests/
¦  +- package.json
¦  +- tsconfig.json
¦  +- Dockerfile
+- web/
¦  +- src/
¦  ¦  +- lib/api.ts
¦  ¦  +- App.tsx
¦  ¦  +- main.tsx
¦  ¦  +- styles.css
¦  +- package.json
¦  +- tsconfig.json
¦  +- vite.config.ts
¦  +- Dockerfile
+- infra/
¦  +- nginx/web.conf
+- scripts/
¦  +- generate-jwt-secret.ps1
+- docs/
¦  +- operations.md
+- docker-compose.yml
+- .env.example
+- README.md
```

## Setup Instructions (Home Server)

### 1. Prerequisites

- Docker Engine 24+
- Docker Compose v2+
- A host directory containing your audio files (`.mp3`, `.flac`, `.m4a`, `.aac`, `.ogg`, `.wav`, `.opus`)

### 2. Configure environment

1. Copy `.env.example` to `.env`.
2. Set a strong `JWT_SECRET`.
   - PowerShell helper:
     ```powershell
     ./scripts/generate-jwt-secret.ps1
     ```
3. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
4. Set `MUSIC_LIBRARY_HOST_PATH` to your host music directory.

Example:

```env
JWT_SECRET=<paste-generated-secret>
ADMIN_EMAIL=admin@local.com
ADMIN_PASSWORD=<strong-password>
MUSIC_LIBRARY_HOST_PATH=D:/Media/Music
```

### 3. Build and start

```bash
docker compose build
docker compose up -d
```

### 4. Access the app

- Web UI: `http://<your-server-ip>:8080`
- API health: `http://<your-server-ip>:4000/api/health`

### 5. First-time library indexing

1. Log in with the admin credentials.
2. Click **Scan Library** in the web UI.
3. Wait for scan completion message.

### 6. Upload from web UI (PC/mobile)

1. Log in to the web UI.
2. Use the file picker in the top toolbar and select one or more music files.
3. Click **Upload**.
4. Uploaded files are stored under `<MUSIC_DIR>/uploads` and scanned automatically.

## Local Development (without Docker)

### API

```bash
cd api
npm ci
npm run dev
```

### Web

```bash
cd web
npm ci
npm run dev
```

The Vite dev server proxies `/api` to `http://localhost:4000`.

## Security and Production Notes

- Change default credentials and secrets before exposing on LAN.
- Restrict inbound access with firewall rules (only trusted network).
- Consider reverse-proxying `:8080` behind TLS (Caddy, Traefik, or Nginx with certificates).
- Keep Docker images and host OS patched.
- Back up `/data/musicstream.db` regularly.

See [docs/operations.md](docs/operations.md) for backups, updates, and troubleshooting.

