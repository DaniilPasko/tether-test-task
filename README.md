# Todos

Offline-first list. The phone is the source of truth. The API keeps a copy once a request succeeds.

## Run

```sh
docker compose up --build
```

API on port 3000. Postgres on 5432, user `todo`, password `todo`, database `todo`.

```sh
curl http://localhost:3000/health
```

```sh
cd app
npm install
npm run ios
```

## Behavior

Newest first. Checkbox, title, delete. The row opens the editor. Add is in the header.

Title is required. Note is optional. Back without Save discards the draft. Checking a row does not reorder it.

Camera, Gallery, and Document. At most 5 files, 10 MB each. No video.

The bar is Offline, Syncing, Synced, or Out of sync, plus `User` and 8 characters of the installation id (`X-Installation-Id`). An empty first launch does not hit the API.

Online, each save, check, and delete is sent immediately. A failed request stays on the phone, the badge goes to Out of sync, and the sync icon retries the queue. Local edits are not rolled back.

## Offline

The API stays up.

The Online switch forces offline. A todo saved in that state stays local until the switch is turned on.

If the network drops, the switch turns off and is disabled. When the network returns it turns on and the queue is sent.

## Data

No list endpoint. Rows are in Postgres, bytes in `/data/uploads`.

```sh
docker compose exec postgres psql -U todo -d todo -c "select id, title, note, completed from todos order by created_at desc;"
docker compose exec postgres psql -U todo -d todo -c "select id, filename, mime, storage_path from attachments;"
docker compose exec api find /data/uploads -type f
```
