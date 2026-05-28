# Provider Setup

This app can use three image provider sources, in priority order:

1. Environment OpenAI-compatible config from `.env`.
2. Local OpenAI-compatible config saved in the app's provider dialog.
3. Codex login fallback.

Environment values are read at API process startup. After changing `.env`, stop and restart `pnpm dev`.

## Basic OpenAI-Compatible Config

Use this mode for providers that support the OpenAI Images API.

```env
OPENAI_API_KEY=sk-your-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_TIMEOUT_MS=1200000
OPENAI_IMAGE_TRANSPORT=images
```

Leave `OPENAI_BASE_URL` empty for the official OpenAI endpoint. For other compatible providers, set it to the provider's `/v1` base URL.

## sub2api / Responses Streaming Config

Some sub2api deployments route image generation through the Responses API and can hit a 120-second proxy read timeout on non-streaming image requests. Use Responses streaming mode for those deployments:

```env
OPENAI_API_KEY=sk-your-key
OPENAI_BASE_URL=https://your-sub2api.example
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_TIMEOUT_MS=1200000
OPENAI_IMAGE_TRANSPORT=responses
OPENAI_RESPONSES_MODEL=gpt-5.5
OPENAI_IMAGE_PARTIAL_IMAGES=2
OPENAI_RESPONSES_REASONING_EFFORT=
```

In `responses` mode the app posts to `/v1/responses`, sets `stream: true`, and uses the `image_generation` tool. If `OPENAI_BASE_URL` is a bare host URL, `/v1/responses` is added automatically. If it already ends in `/v1`, only `/responses` is appended.

`OPENAI_IMAGE_PARTIAL_IMAGES` accepts `0` to `3`. Values above `0` ask the upstream to emit partial image events earlier. If a stream is interrupted after a partial image arrives, the app saves the latest partial image instead of failing the entire output.

`OPENAI_RESPONSES_REASONING_EFFORT` is optional. Leave it blank unless your proxy expects a Responses `reasoning.effort` field.

## Dev Server Ports

The API and web dev server use `.env` too:

```env
PORT=28787
HOST=127.0.0.1
VITE_WEB_PORT=15173
VITE_API_PROXY_TARGET=http://127.0.0.1:28787
```

`VITE_API_PROXY_TARGET` is optional. If omitted, the web dev server proxies `/api` to `http://HOST:PORT`.

`pnpm dev` starts the API first and waits for `/api/auth/status` before starting Vite, which avoids early proxy connection errors while the API is still compiling.

## Verification

Run these before committing provider or dev-server changes:

```sh
pnpm typecheck
pnpm build
```

For browser verification:

```sh
pnpm dev
```

Then open the configured web URL, for example `http://127.0.0.1:15173`.

If generation still fails with HTTP 524 in sub2api mode, the proxy in front of sub2api did not send any complete final image or partial image before its read timeout. Try a smaller size, lower quality, a single output, or a sub2api deployment without a short read-timeout proxy.
