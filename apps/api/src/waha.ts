import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { dataDir } from "./db";

/**
 * Optional helper that runs the official WAHA Docker image for the user, bound to localhost only,
 * with a generated API key kept in the local data folder. If WAHA_API_KEY is set in the environment,
 * that key wins and this helper is only used to start/stop the container.
 */
const run = promisify(execFile);
export const WAHA_CONTAINER = "rumireach-waha";
const IMAGE = process.env.RUMIREACH_WAHA_IMAGE || "devlikeapro/waha";
/** NOWEB talks to WhatsApp directly (no Chromium): boots in seconds and never hangs in STARTING the way the browser engine can. */
const ENGINE = process.env.RUMIREACH_WAHA_ENGINE || "NOWEB";
const keyFile = join(dataDir, "waha.json");
const sessionsDir = join(dataDir, "waha-sessions");

export function wahaKey(): string {
  if (process.env.WAHA_API_KEY) return process.env.WAHA_API_KEY;
  try { return (JSON.parse(readFileSync(keyFile, "utf8")) as { apiKey?: string }).apiKey || ""; } catch { return ""; }
}

function ensureKey(): string {
  const existing = wahaKey();
  if (existing) return existing;
  const apiKey = randomBytes(24).toString("hex");
  writeFileSync(keyFile, JSON.stringify({ apiKey }), { mode: 0o600 });
  return apiKey;
}

/** Pure: arguments for `docker run`. Publishes on 127.0.0.1 only and disables the public dashboard/swagger. */
export function buildRunArgs(apiKey: string, sessions: string, image = IMAGE, engine = ENGINE): string[] {
  const args = ["run", "-d", "--name", WAHA_CONTAINER, "--restart", "unless-stopped",
    "--shm-size", "1g",
    "-p", "127.0.0.1:3000:3000",
    "-e", "WAHA_API_KEY=" + apiKey,
    "-e", "WAHA_DASHBOARD_ENABLED=False",
    "-e", "WHATSAPP_SWAGGER_ENABLED=False",
    "-v", sessions + ":/app/.sessions"];
  if (engine) args.push("-e", "WHATSAPP_DEFAULT_ENGINE=" + engine);
  args.push(image);
  return args;
}

async function docker(args: string[], timeout = 15_000) {
  return run("docker", args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
}

export type ServiceState = { external: boolean; docker: boolean; container: "missing" | "running" | "stopped"; starting: boolean; error: string };
let starting: Promise<void> | null = null;
let lastError = "";

export async function serviceState(): Promise<ServiceState> {
  // Docker Compose runs WAHA next to RumiReach; there is nothing for us to start or stop.
  if (process.env.RUMIREACH_WAHA_EXTERNAL === "true") return { external: true, docker: true, container: "running", starting: false, error: "" };
  try { await docker(["version", "--format", "{{.Server.Version}}"], 8000); }
  catch { return { external: false, docker: false, container: "missing", starting: starting !== null, error: lastError }; }
  try {
    const { stdout } = await docker(["inspect", "-f", "{{.State.Running}}", WAHA_CONTAINER]);
    return { external: false, docker: true, container: stdout.trim() === "true" ? "running" : "stopped", starting: starting !== null, error: lastError };
  } catch { return { external: false, docker: true, container: "missing", starting: starting !== null, error: lastError }; }
}

/** Starts (creating on first use) the container in the background. The first run downloads the image, which can take minutes. */
export function startService(): boolean {
  if (starting) return false;
  lastError = "";
  starting = (async () => {
    const state = await serviceState();
    if (!state.docker) throw new Error("Docker is not running. Install/start Docker Desktop first.");
    if (state.container === "running") return;
    if (state.container === "stopped") { await docker(["start", WAHA_CONTAINER], 60_000); return; }
    mkdirSync(sessionsDir, { recursive: true });
    await docker(buildRunArgs(ensureKey(), sessionsDir), 20 * 60_000);
  })()
    .catch(error => { lastError = (error as { stderr?: string }).stderr?.trim().split("\n").pop() || (error instanceof Error ? error.message : "Could not start WAHA."); })
    .finally(() => { starting = null; });
  return true;
}

export async function stopService() {
  await docker(["stop", WAHA_CONTAINER], 60_000);
}

export const wahaConfigPresent = () => existsSync(keyFile) || !!process.env.WAHA_API_KEY;
