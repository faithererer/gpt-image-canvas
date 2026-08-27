# GPT Image Canvas

[English](README.md) | [简体中文](README.zh-CN.md)

Local AI image canvas for prompt-to-image generation, reference-image generation, and multi-step Agent planning. It combines tldraw, Hono, SQLite, and GPT Image 2 into a local-first creative workspace.

## Preview

![GPT Image Canvas preview](docs/assets/app-preview.png)

## What It Does

- Create and arrange AI-generated images on a tldraw canvas.
- Generate from text prompts or use selected canvas images as references.
- Save project state, generation history, and generated assets locally.
- Configure image providers from `.env`, the in-app provider dialog, or Codex login.
- Plan multi-image work in the Agent tab, then execute DAG-based generation jobs around a plan node.
- Optionally back up new generated images to Tencent Cloud COS or Cloudflare R2 / S3-compatible storage.
- Browse local outputs in Gallery, including rerun, locate, download, and upload status.

## Requirements

- Node.js `24.15.0`. The repo includes `.nvmrc` and `.node-version`.
- pnpm `9.14.2`. The version is pinned in `package.json`.
- An OpenAI API key with access to `gpt-image-2`, an OpenAI-compatible image endpoint, or a Codex login completed inside the app.
- Docker Desktop or a compatible Docker Engine, only if you want the Docker workflow.

Activate the pinned package manager with Corepack if needed:

```sh
corepack prepare pnpm@9.14.2 --activate
```

## Quick Start

Windows PowerShell:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm dev
```

macOS/Linux:

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Open the web app at [http://localhost:5173](http://localhost:5173).

`pnpm dev` starts both local services:

- API: [http://127.0.0.1:8787](http://127.0.0.1:8787)
- Web: [http://localhost:5173](http://localhost:5173), proxying `/api` to the API service

The app can start without credentials. Without a usable provider, `/` shows the credential-aware homepage and generation requests return `missing_provider` until you configure one.

## Configure Generation

The default provider order is:

1. Environment OpenAI-compatible config from `.env` or runtime variables.
2. Local OpenAI-compatible config saved in the app.
3. Codex login fallback.

For the simplest API-key setup, edit `.env`:

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_TIMEOUT_MS=1200000
CODEX_RESPONSES_MODEL=gpt-5.5
```

Leave `OPENAI_BASE_URL` empty for the official OpenAI API. Set it to an OpenAI-compatible `/v1` endpoint when using another provider, and set `OPENAI_IMAGE_MODEL` if that endpoint expects a different image model name.
When using Codex login, `CODEX_RESPONSES_MODEL` controls the mainline Responses model for the ChatGPT OAuth bridge; `OPENAI_IMAGE_MODEL` remains the image-generation tool model.

The canvas uses tldraw's supported development mode on localhost/HTTP when `VITE_TLDRAW_LICENSE_KEY` is blank. For a deployment that requires a tldraw hobby or commercial license, set `VITE_TLDRAW_LICENSE_KEY` before running `pnpm build` (or as a Docker build argument). This value is embedded in the public web bundle, so changing it requires a rebuild. The GHCR workflow reads the optional `TLDRAW_LICENSE_KEY` repository secret.

You can also open the top-right `配置` dialog and save one local OpenAI-compatible provider. Local keys are stored in SQLite under `DATA_DIR`, returned only as masked values, and preserved until you enter a replacement key.

## Routes

- `/` is the credential-aware homepage. It offers `Codex 登录` and `接入 API` when no provider is available.
- `/canvas` is the working canvas. Without a provider, it redirects back to `/`.
- `/pool` is the bundled Prompt Pool for browsing, searching, favoriting, copying, and reusing curated prompts.
- `/gallery` remains available even without credentials, so local work can still be viewed.

Environment values are read-only in the provider dialog. If you change `.env`, restart the API or Docker container.

## Using the Canvas

The right-side panel has two main flows:

- `Manual`: enter a prompt, choose size/quality/format, and generate. Selecting one image shape switches the flow into reference-image generation.
- `Agent`: describe a multi-image task, optionally select up to three canvas images, review the generated plan node, then execute it.

Agent planning uses a separate OpenAI-compatible chat configuration from the image provider. Save it in the Agent LLM settings with API key, Base URL, model, timeout, and `supportsVision`.

When `supportsVision` is enabled, selected images are attached to the planning request as multimodal inputs. When disabled, selected images are passed only as reference handles for later image generation. Agent messages are not persisted in this version; plan nodes already on the canvas are saved with the normal canvas snapshot.

Plan execution is DAG-based. Independent jobs can run in parallel, jobs that reference generated outputs wait for their dependencies, and `Retry failed` reruns failed or blocked jobs while keeping successful upstream outputs. A single plan is capped at 16 generated images, including intermediate anchors.

## Cloud Backup

Generated images are always saved locally first. If Tencent Cloud COS or Cloudflare R2 / S3-compatible storage is enabled from the in-app cloud storage dialog, new images are also uploaded to:

```text
<key-prefix>/YYYY/MM/<assetId>.<ext>
```

The COS fields are prefilled from:

- `COS_DEFAULT_BUCKET`
- `COS_DEFAULT_REGION`
- `COS_DEFAULT_KEY_PREFIX`

The S3/R2 fields are prefilled from:

- `S3_DEFAULT_BUCKET`
- `S3_DEFAULT_REGION`
- `S3_DEFAULT_KEY_PREFIX`
- `R2_DEFAULT_ACCOUNT_ID`
- `S3_DEFAULT_ENDPOINT`

Saving cloud storage settings performs a test upload and delete before the config is persisted. Provider secrets are stored in local SQLite and only returned as masked values. Cloud upload failures do not fail image generation; the image remains available locally and the history item shows the upload failure.

## Project Layout

```text
apps/api         Hono API, SQLite storage, provider selection, Agent planning/execution
apps/web         Vite + React + tldraw web app
packages/shared  Shared contracts and constants
docs             Project docs and preview assets
data             Local runtime data, ignored by Git
```

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start API and web dev servers. |
| `pnpm api:dev` | Start the API dev workflow. |
| `pnpm web:dev` | Start the Vite web dev workflow. |
| `pnpm typecheck` | Typecheck shared, web, and API packages. |
| `pnpm build` | Build shared, web, and API packages. |
| `pnpm start` | Start the built API package. |
| `pnpm --filter @gpt-image-canvas/api smoke:planner` | Check Agent plan validation fixtures. |
| `pnpm --filter @gpt-image-canvas/api smoke:agent` | Check Agent config and WebSocket basics. |
| `pnpm --filter @gpt-image-canvas/api smoke:executor` | Check Agent DAG execution with a fake image provider. |

Before completing code changes, run:

```sh
pnpm typecheck
pnpm build
```

For UI changes, run `pnpm dev` and verify the Vite app in a browser at [http://localhost:5173](http://localhost:5173).

If `better-sqlite3` reports a `NODE_MODULE_VERSION` mismatch after switching Node versions, rebuild it:

```sh
pnpm --filter @gpt-image-canvas/api rebuild better-sqlite3 --stream
```

## Docker

Docker Compose builds shared contracts, the web app, Prompt Pool JSON data, and the API into one image. The API serves both `/api` and the built web bundle from one localhost port. SQLite data and generated assets persist in host `./data`.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
docker compose config --quiet --no-env-resolution
docker compose up --build
```

macOS/Linux:

```sh
cp .env.example .env
docker compose config --quiet --no-env-resolution
docker compose up --build
```

Open [http://localhost:8787](http://localhost:8787) by default. Set `PORT` in `.env` before starting Compose to use a different localhost port.

The `/pool` route reads bundled JSON from `prompt-pool-data/prompts-all.json` and optionally `prompt-pool-data/summary.json`. Images are not bundled, mounted, or copied; card images use GitHub raw URLs from the JSON. Advanced users can set `PROMPT_POOL_DIR` to another directory containing `prompts-all.json`.

Use `docker compose config --quiet --no-env-resolution` when real credentials exist. Plain `docker compose config` expands env files and can print secrets.

Compose defaults `SQLITE_JOURNAL_MODE=DELETE` and `SQLITE_LOCKING_MODE=EXCLUSIVE` to avoid SQLite shared-memory errors on Docker Desktop bind mounts. Avoid running `pnpm dev` and Docker against the same `data/` directory at the same time.

### Prebuilt GHCR Image

Release publishing pushes a multi-platform image to GHCR, so upgrades can pull the repository image instead of rebuilding locally:

```sh
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

The default image is `ghcr.io/mrslimslim/gpt-image-canvas:latest`. To pin a release, set `IMAGE` before running Compose, for example `ghcr.io/mrslimslim/gpt-image-canvas:v0.4.0`.

Release tags are published as `vX.Y.Z`, `X.Y.Z`, and `X.Y`; non-prerelease GitHub Releases also update `latest`. Public GHCR packages can be pulled anonymously. If GitHub shows the package as private, run `docker login ghcr.io` or make the package public in the repository package settings.

The Compose build accepts these network-related build args:

- `NODE_IMAGE`
- `NPM_CONFIG_REGISTRY`
- `APT_MIRROR`
- `APT_SECURITY_MIRROR`

The default `NODE_IMAGE` is `node:24.15.0-bookworm-slim`.

## Runtime Data And Secrets

`DATA_DIR` defaults to `./data` locally and `/app/data` in Docker. It contains:

- `gpt-image-canvas.sqlite`: project state, generation history, asset metadata, provider config, Agent LLM config, optional cloud storage config, and Codex OAuth token records.
- `assets/`: generated image files.

Do not commit `.env`, `.ralph/`, `.codex-temp/`, `data/`, generated images, SQLite databases, or build output.

Treat `data/gpt-image-canvas.sqlite` as sensitive after saving local provider keys, Agent LLM keys, cloud storage secrets, or Codex tokens. The app is designed for local workstation use; do not expose it publicly without adding your own authentication and network controls.

If a real API key was ever committed, rotate the key. Git ignore rules prevent future leaks, but they do not remove secrets from existing Git history.

## Troubleshooting

- Missing provider: add `OPENAI_API_KEY` to `.env` and restart, save a local provider from `配置`, or complete `Codex 登录`.
- Codex login fails: confirm the machine can reach `https://auth.openai.com`, keep the login dialog open, and restart the flow if the user code expires.
- Custom endpoint fails: confirm `OPENAI_BASE_URL` points to an OpenAI-compatible `/v1` endpoint and supports the configured image model.
- Agent cannot plan: save the Agent LLM config separately from the image provider config. If `supportsVision` is enabled and the request fails, try fewer or smaller selected images.
- Agent plan cannot execute: confirm the normal image provider is configured; Agent planning and image generation use separate configs.
- Port conflict: set `PORT` for API/Docker. For web dev, stop the process on `5173` or run `pnpm web:dev -- --port 5174`.
- Docker cannot pull the base image: restore Docker Hub access or set `NODE_IMAGE` to an equivalent cached Node `24.15.0` image.
- Docker Prompt Pool is empty: rebuild the image so bundled `prompt-pool-data/prompts-all.json` is copied into the container; if overriding `PROMPT_POOL_DIR`, confirm it points to a directory containing `prompts-all.json`.
- SQLite `SQLITE_IOERR_SHMOPEN` in Docker: keep the Compose SQLite defaults, rebuild, and make sure no local API process is using the same database.
- SQLite `SQLITE_CORRUPT`: stop all app processes, back up `data/`, then restore from backup or remove the SQLite files to create a clean database. Files under `data/assets/` can be kept.
- Stale local state: stop the app and remove files under `data/`. This deletes local project state, history, and generated assets.

## Upgrading

Before upgrading an older local install, back up runtime data:

Windows PowerShell:

```powershell
Copy-Item -Recurse data data-backup-before-upgrade
docker compose up --build
```

macOS/Linux:

```sh
cp -R data data-backup-before-upgrade
docker compose up --build
```

Rebuild the web app and API together after an upgrade.

## Codex Notes

Codex can work directly in this repository. Let it read `AGENTS.md`, then use the pinned package manager:

```sh
pnpm install
pnpm typecheck
pnpm build
```

Keep credentials out of prompts and logs. For Ralph-driven work, read `docs/ralph-execution.md`; keep PRDs under `.agents/tasks/`, runtime state under `.ralph/`, and scratch files under `.codex-temp/`.

## License

MIT

## Friendly Links

- [LINUX DO - 新的理想型社区](https://linux.do/)
