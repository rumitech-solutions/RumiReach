import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Pulls the first dotted number out of a version string ("v1.12.1", "2026.6.1 (plus)") → [1,12,1]. */
export function parseVersion(text: string | undefined | null): number[] | null {
  const match = /(\d+(?:\.\d+){1,3})/.exec(text || "");
  return match ? match[1].split(".").map(Number) : null;
}

export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export type UpdateStatus = "update" | "current" | "unknown";
export function updateStatus(installed: string | null, latest: string | null): UpdateStatus {
  const a = parseVersion(installed), b = parseVersion(latest);
  if (!b) return "unknown";
  if (!a) return "unknown";
  return compareVersions(a, b) < 0 ? "update" : "current";
}

export async function latestRelease(repo: string): Promise<{ version: string; url: string } | null> {
  try {
    const response = await fetch("https://api.github.com/repos/" + repo + "/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "RumiReach-update-check" },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return null;
    const data = await response.json() as { tag_name?: string; html_url?: string };
    return data.tag_name ? { version: data.tag_name, url: data.html_url || "https://github.com/" + repo + "/releases" } : null;
  } catch { return null; }
}

export async function binaryVersion(path: string): Promise<string | null> {
  try { const { stdout, stderr } = await run(path, ["-version"], { timeout: 6000, windowsHide: true }); return (stdout + " " + stderr).trim() || null; }
  catch { return null; }
}
