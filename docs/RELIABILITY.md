# Reliability Guide

Use this before changing API routes, provider selection, Agent execution, asset storage, SQLite behavior, Docker, or operational verification.

## Runtime Shape

- `apps/api`: Hono API, WebSocket upgrade handling, SQLite persistence, provider selection, image generation, Agent planning and execution, asset storage.
- `apps/web`: Vite React and tldraw client, served by Vite in development and by the built API app in production.
- `packages/shared`: shared contracts, image presets, validation helpers, provider types, storage types, and Agent event types.

## Persistence

`DATA_DIR` defaults to `./data` locally and `/app/data` in Docker. It contains SQLite state and generated assets. Treat it as private runtime data.

SQLite tables are defined in `apps/api/src/infrastructure/schema.ts`; keep `docs/generated/db-schema.md` updated when the schema changes.

Important persistence rules:

- Never write generated assets outside the configured data/assets path.
- Validate asset paths before reading from disk.
- Keep generation records, outputs, reference assets, and asset rows consistent.
- If changing snapshot format, preserve old project restore behavior or document migration behavior.
- Do not run local `pnpm dev` and Docker against the same `data/` directory at the same time.
- The API runs `PRAGMA quick_check` at startup and should fail fast if SQLite reports corruption. Do not bypass this and keep using the same database; stop the app and restore from backup first.
- Project snapshots are backed up outside SQLite under `data/project-snapshot-backups/` as rotated `.json.gz` files. Treat them as private runtime data and use the newest valid snapshot if the `projects` row becomes unreadable. The backup directory is bounded by count, compressed byte size, and a minimum write interval; tune `PROJECT_SNAPSHOT_BACKUP_MAX_COUNT`, `PROJECT_SNAPSHOT_BACKUP_MAX_BYTES`, `PROJECT_SNAPSHOT_BACKUP_MIN_COUNT`, and `PROJECT_SNAPSHOT_BACKUP_MIN_INTERVAL_MS` only when local recovery needs justify the disk cost.
- Project saves should not replace a large, non-empty saved canvas with an empty snapshot. A rejected empty overwrite usually means the client loaded a fallback/failed project state and should be reloaded after the database issue is fixed.

## Provider Reliability

Provider source order is:

1. Environment OpenAI-compatible config.
2. Local OpenAI-compatible config stored in SQLite.
3. Codex login fallback.

Agent planning uses separate Agent LLM configuration. Do not assume the image provider and planning model are the same provider.

Provider errors should become stable API errors where possible. Avoid exposing raw secrets, raw token values, or noisy upstream internals in responses or logs.

OpenAI-compatible image providers can use either the Images API transport or Responses streaming transport. Use `OPENAI_IMAGE_TRANSPORT=responses` for sub2api-style providers that need `/v1/responses` streaming and `image_generation` tool routing. See `docs/PROVIDER_SETUP.md`.

## Image Generation

- Text-to-image and reference-image generation both persist generation records.
- Reference image inputs are size and MIME checked.
- Batch generation uses bounded concurrency.
- Individual output failures should be represented in output status instead of erasing the whole record when partial results exist.
- Generated images must remain locally available even if cloud upload fails.

## Agent Execution

Agent plans are dependency-aware DAGs. Reliability-sensitive rules:

- Plans must be validated before execution.
- Dependency source jobs used downstream must have count `1`.
- Failed jobs can be retried without rerunning successful upstream jobs.
- Cancellation should stop in-flight work where possible and leave the plan in an inspectable state.
- WebSocket events should be stable, typed through `packages/shared`, and safe for reconnect behavior.

## Cloud Backup

Tencent Cloud COS and Cloudflare R2 / S3-compatible storage are optional. Saving cloud storage settings performs a test upload and delete before persistence.

Cloud upload failures must not fail local image generation. Store upload status and error metadata on the asset so the UI can explain what happened.

## Docker And Build Checks

For normal stories, run:

```sh
pnpm typecheck
pnpm build
```

For browser verification, run:

```sh
pnpm dev
```

Then open `http://localhost:5173`, or the configured `VITE_WEB_PORT` URL.

For Docker config validation with real `.env` credentials, use:

```sh
docker compose config --quiet --no-env-resolution
```

Do not run plain `docker compose config` when `.env` may contain real secrets.

