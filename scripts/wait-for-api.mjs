import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function readEnvValue(values, key) {
  return process.env[key]?.trim() || values[key]?.trim();
}

function readLocalEnv() {
  const envPath = resolve(repoRoot, ".env");
  const values = {};

  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) {
        continue;
      }

      const [, key, rawValue] = match;
      values[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    return values;
  }

  return values;
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

const localEnv = readLocalEnv();
const host = readEnvValue(localEnv, "HOST") || "127.0.0.1";
const port = parsePort(readEnvValue(localEnv, "PORT"), 8787);
const apiProxyTarget = readEnvValue(localEnv, "VITE_API_PROXY_TARGET") || `http://${host}:${port}`;
const healthUrl = new URL("/api/auth/status", apiProxyTarget).toString();
const deadline = Date.now() + 30_000;

process.stdout.write(`[web] Waiting for API at ${healthUrl}`);

while (Date.now() < deadline) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_500) });
    if (response.ok) {
      process.stdout.write("\n[web] API is ready; starting Vite.\n");
      process.exit(0);
    }
  } catch {
    // API is still compiling or has not opened its port yet.
  }

  process.stdout.write(".");
  await delay(500);
}

process.stderr.write(`\n[web] Timed out waiting for API at ${healthUrl}.\n`);
process.exit(1);
