# Operations Guide

## Backups

- SQLite DB is persisted in Docker volume `musicstream_data` at `/data/musicstream.db` inside API container.
- Recommended schedule: daily backup + weekly offsite/local archive.

Example backup command:

```bash
docker exec musicstream-api sh -c "cp /data/musicstream.db /data/musicstream.db.bak"
```

## Upgrades

1. Pull latest code.
2. Rebuild containers.
3. Restart services.

```bash
docker compose build --no-cache
docker compose up -d
```

## Health checks

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
curl http://localhost:4000/api/health
```

## Common issues

1. No tracks visible after login.
   - Verify `MUSIC_LIBRARY_HOST_PATH` in `.env`.
   - Ensure container can read `/music` mount.
   - Trigger `Scan Library` as admin.

2. Playback fails with 404.
   - File moved or deleted after last scan.
   - Run scan again to refresh index.

3. Login fails for admin.
   - Confirm `ADMIN_EMAIL` and `ADMIN_PASSWORD` were set before initial startup.
   - If changed later, update via DB/user workflow or recreate user.

## Hardening options

- Place app behind HTTPS reverse proxy.
- Disable user self-registration: `ALLOW_REGISTRATION=false`.
- Use long random `JWT_SECRET` and rotate periodically.
- Limit LAN exposure via firewall/network ACL.
