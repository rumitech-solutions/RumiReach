import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db, dataDir } from "./db";
import { parseCsv } from "./csv";
import { IMPORT_SOURCE, createImportSession, importSessions, insertRows, type ImportRow } from "./importer";

/**
 * Runs the vendored Google Maps scraper (services/gmaps-scraper, Go, MIT) as a local child process
 * and imports its CSV output through the normal RumiReach import pipeline.
 */

export const MAX_QUERIES = 200;
export const MAX_CITIES_DEFAULT = 10;
export const MAX_CITIES_LIMIT = 50;
const DOCKER_IMAGE = process.env.RUMIREACH_SCRAPER_IMAGE || "gosom/google-maps-scraper";
const MAX_RUN_MINUTES = Math.max(1, Number(process.env.RUMIREACH_SCRAPE_MAX_MINUTES) || 120);
const CONCURRENCY = Math.min(8, Math.max(1, Number(process.env.RUMIREACH_SCRAPE_CONCURRENCY) || 2));
const scrapesDir = join(dataDir, "scrapes");
const WORKSPACE_RETENTION_HOURS = Math.max(
  24,
  Math.min(24 * 30, Number(process.env.RUMIREACH_SCRAPE_WORKSPACE_RETENTION_HOURS) || 24)
);
const repoRoot = join(__dirname, "..", "..", "..");

// Scrape workspaces contain temporary query/result files, not the saved lead database.
// Remove abandoned workspaces after the retention window; cleanup must never block startup.
async function cleanupStaleScrapeWorkspaces() {
  try {
    const entries = await readdir(scrapesDir, { withFileTypes: true });
    const activeRows = db.prepare("SELECT id FROM scrape_runs WHERE status IN ('running','importing')").all() as Array<{ id: string }>;
    const activeIds = new Set(activeRows.map(row => row.id));
    const cutoff = Date.now() - WORKSPACE_RETENTION_HOURS * 60 * 60 * 1000;
    await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
      const workspace = join(scrapesDir, entry.name);
      try {
        const info = await stat(workspace);
        if (!activeIds.has(entry.name) && info.mtimeMs < cutoff) {
          await rm(workspace, { recursive: true, force: true });
        }
      } catch {
        // Best-effort cleanup: one inaccessible folder must not stop the API.
      }
    }));
  } catch {
    // The folder may not exist yet; it is created when the first scrape starts.
  }
}
void cleanupStaleScrapeWorkspaces();

export type ScrapeRequest = {
  keywords: string[];
  countryName: string;
  stateName?: string;
  cities: string[];
  depth: number;
  email: boolean;
  lang: string;
};

export function cleanQueryPart(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** keyword × location → one Google Maps search phrase per line, e.g. "dentist in Lahore, Punjab, Pakistan". */
export function buildQueries(req: Pick<ScrapeRequest, "keywords" | "countryName" | "stateName" | "cities">): string[] {
  const suffix = [req.stateName, req.countryName].map(part => cleanQueryPart(part || "")).filter(Boolean).join(", ");
  const places = req.cities.length
    ? req.cities.map(city => [cleanQueryPart(city), suffix].filter(Boolean).join(", "))
    : [suffix];
  const keywords = [...new Set(req.keywords.map(cleanQueryPart).filter(Boolean))];
  const queries: string[] = [];
  for (const keyword of keywords) for (const place of places) queries.push(keyword + " in " + place);
  return queries;
}

/** Extracts the first usable address from the scraper's "emails" column (comma/semicolon separated or JSON-ish). */
export function firstEmail(value: string | undefined) {
  return (value || "").split(/[\s,;|\[\]"']+/).find(part => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(part)) || "";
}

export type RunnerInfo = { available: boolean; mode: "binary" | "docker" | "none"; path?: string; hint: string };

function binaryPath() {
  return process.env.RUMIREACH_SCRAPER_BIN
    || join(repoRoot, "services", "gmaps-scraper", "bin", process.platform === "win32" ? "google-maps-scraper.exe" : "google-maps-scraper");
}

function dockerAvailable() {
  try { return spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 8000, stdio: "ignore" }).status === 0; }
  catch { return false; }
}

export function resolveRunner(): RunnerInfo {
  const bin = binaryPath();
  if (existsSync(bin)) return { available: true, mode: "binary", path: bin, hint: "Using the locally built scraper binary." };
  if (dockerAvailable()) return { available: true, mode: "docker", hint: "Using Docker image " + DOCKER_IMAGE + " (pulled on first run)." };
  return { available: false, mode: "none", hint: "Scraper not found. Either run `npm run build:scraper` (needs Go) or install/start Docker Desktop." };
}

type LiveRun = { child?: ChildProcess; log: string[]; cancelled: boolean; startedAt: number; timer?: NodeJS.Timeout };
const live = new Map<string, LiveRun>();

function pushLog(run: LiveRun, chunk: string) {
  for (const line of chunk.split(/\r?\n/)) {
    const text = line.trim();
    if (text) run.log.push(text.slice(0, 300));
  }
  if (run.log.length > 40) run.log.splice(0, run.log.length - 40);
}

export function activeRunId() {
  const row = db.prepare("SELECT id FROM scrape_runs WHERE status IN ('running','importing') LIMIT 1").get() as { id: string } | undefined;
  return row?.id;
}

export async function startScrape(req: ScrapeRequest, meta: { country: string; state?: string; city?: string; name?: string; request?: unknown }) {
  const queries = buildQueries(req);
  if (!queries.length) throw new Error("Add at least one keyword.");
  if (queries.length > MAX_QUERIES) throw new Error("Too many searches (" + queries.length + "). Reduce keywords or cities to " + MAX_QUERIES + " or fewer.");
  const runner = resolveRunner();
  if (!runner.available) throw new Error(runner.hint);

  const id = randomUUID();
  const name = cleanQueryPart(meta.name || "").slice(0, 100) || [req.keywords.slice(0, 2).join(", "), [meta.city, meta.state, meta.country].filter(Boolean).join(", ")].join(" · ");
  const workDir = join(scrapesDir, id);
  await mkdir(workDir, { recursive: true });
  const queryFile = join(workDir, "queries.txt");
  const resultsFile = join(workDir, "results.csv");
  await writeFile(queryFile, queries.join("\n") + "\n", "utf8");

  const common = ["-depth", String(req.depth), "-lang", req.lang, "-c", String(CONCURRENCY), "-exit-on-inactivity", "3m"];
  if (req.email) common.push("-email");
  let command: string, args: string[];
  if (runner.mode === "binary") {
    command = runner.path!;
    args = ["-input", queryFile, "-results", resultsFile, ...common];
  } else {
    command = "docker";
    args = ["run", "--rm", "-v", "gmaps-playwright-cache:/opt", "-v", workDir + ":/work", DOCKER_IMAGE, "-input", "/work/queries.txt", "-results", "/work/results.csv", ...common];
  }

  db.prepare("INSERT INTO scrape_runs (id,keywords,country,state,city,query_count,runner,status,created_at,name,request_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, req.keywords.join(", "), meta.country, meta.state || null, meta.city || null, queries.length, runner.mode, "running", new Date().toISOString(), name, meta.request ? JSON.stringify(meta.request) : null);

  const run: LiveRun = { log: ["Starting " + queries.length + " search" + (queries.length === 1 ? "" : "es") + " via " + runner.mode + "…"], cancelled: false, startedAt: Date.now() };
  live.set(id, run);
  const child = spawn(command, args, { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  run.child = child;
  child.stdout.on("data", data => pushLog(run, String(data)));
  child.stderr.on("data", data => pushLog(run, String(data)));
  run.timer = setTimeout(() => { pushLog(run, "Time limit reached; stopping."); run.cancelled = true; child.kill(); }, MAX_RUN_MINUTES * 60_000);
  child.on("error", error => void finish(id, run, resultsFile, queries, { ...meta, name }, null, error.message));
  child.on("close", code => void finish(id, run, resultsFile, queries, { ...meta, name }, code));
  return { id, queryCount: queries.length, queries: queries.slice(0, 5) };
}

async function finish(id: string, run: LiveRun, resultsFile: string, queries: string[], meta: { country: string; state?: string; city?: string; name?: string }, code: number | null, spawnError?: string) {
  if (run.timer) clearTimeout(run.timer);
  const status = (db.prepare("SELECT status FROM scrape_runs WHERE id=?").get(id) as { status: string } | undefined)?.status;
  if (status !== "running") return; // 'error' then 'close' can both fire
  db.prepare("UPDATE scrape_runs SET status='importing' WHERE id=?").run(id);
  pushLog(run, "Scraper finished. Importing results…");
  let imported = 0, skipped = 0, duplicates = 0, importJobId: string | null = null, problem = spawnError || "";
  try {
    if (existsSync(resultsFile) && statSync(resultsFile).size > 0) {
      const result = await importResults(id, resultsFile, queries, meta);
      ({ imported, skipped, duplicates } = result); importJobId = result.jobId;
    } else if (!problem) problem = run.cancelled ? "Stopped before any results were written." : "The scraper finished without producing any results.";
  } catch (error) {
    problem = "Result import failed: " + (error instanceof Error ? error.message : "unknown error");
  }
  if (!problem && code !== 0 && code !== null && !run.cancelled) problem = "Scraper exited with code " + code + "; partial results (if any) were imported.";
  const final = run.cancelled ? "cancelled" : problem && !imported ? "failed" : "completed";
  db.prepare("UPDATE scrape_runs SET status=?,imported=?,skipped=?,duplicates=?,error_message=?,import_job_id=?,finished_at=? WHERE id=?")
    .run(final, imported, skipped, duplicates, problem || null, importJobId, new Date().toISOString(), id);
  pushLog(run, final === "completed" ? "Done: " + imported + " new businesses imported (" + duplicates + " already in your directory)." : problem || "Stopped.");
  run.child = undefined;

  // The imported rows and run status are already stored in SQLite; the CSV/query files
  // are temporary artifacts and can be deleted immediately after the run finishes.
  try {
    await rm(join(scrapesDir, id), { recursive: true, force: true });
  } catch {
    pushLog(run, "Temporary scrape files could not be removed; startup cleanup will retry later.");
  }
}

async function importResults(runId: string, resultsFile: string, queries: string[], meta: { country: string; state?: string; city?: string; name?: string }) {
  const rows = parseCsv(await readFile(resultsFile, "utf8")) as ImportRow[];
  const place = [meta.city, meta.state, meta.country].filter(Boolean).join(", ");
  const session = createImportSession("gmaps-scrape-" + runId.slice(0, 8) + ".csv", { name: meta.name, category: queries.slice(0, 3).join(" | ").slice(0, 200), city: place });
  const exists = db.prepare("SELECT 1 FROM candidates WHERE source_id=? AND source_url=? LIMIT 1");
  const seen = new Set<string>();
  let duplicates = 0;
  const fresh: ImportRow[] = [];
  for (const row of rows) {
    row.email = row.email || firstEmail(row.emails);
    const link = row.link || "";
    if (link) {
      if (seen.has(link) || exists.get(IMPORT_SOURCE, link)) { duplicates++; continue; }
      seen.add(link);
    }
    fresh.push(row);
  }
  try {
    for (let offset = 0; offset < fresh.length; offset += 500) {
      insertRows(session, fresh.slice(offset, offset + 500), session.nextRow);
      db.prepare("UPDATE search_jobs SET candidate_count=? WHERE id=?").run(session.imported, session.jobId);
    }
    db.prepare("UPDATE search_jobs SET status='completed',candidate_count=?,finished_at=? WHERE id=?").run(session.imported, new Date().toISOString(), session.jobId);
    // Nothing new (all duplicates): do not leave an empty collection behind.
    if (!session.imported) { db.prepare("DELETE FROM search_jobs WHERE id=?").run(session.jobId); return { imported: 0, skipped: session.skipped, duplicates, jobId: null }; }
  } catch (error) {
    db.prepare("UPDATE search_jobs SET status='failed',error_message=?,finished_at=? WHERE id=?").run("Scrape import failed.", new Date().toISOString(), session.jobId);
    throw error;
  } finally {
    importSessions.delete(session.batchId);
  }
  return { imported: session.imported, skipped: session.skipped, duplicates, jobId: session.jobId };
}

export function cancelScrape(id: string) {
  const run = live.get(id);
  if (!run?.child) return false;
  run.cancelled = true;
  pushLog(run, "Cancelling…");
  run.child.kill();
  // `docker run` forwards SIGTERM; make sure a stuck process does not linger.
  setTimeout(() => { try { run.child?.kill("SIGKILL"); } catch { /* already gone */ } }, 10_000).unref();
  return true;
}

export function listScrapes(limit = 15) {
  const rows = db.prepare("SELECT id,name,keywords,country,state,city,query_count AS queryCount,runner,status,imported,skipped,duplicates,import_job_id AS collectionId,error_message AS error,created_at AS createdAt,finished_at AS finishedAt FROM scrape_runs ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown> & { id: string }>;
  return rows.map(row => {
    const run = live.get(row.id);
    return { ...row, log: run ? run.log.slice(-6) : [], elapsedSeconds: run && (row.status === "running" || row.status === "importing") ? Math.round((Date.now() - run.startedAt) / 1000) : null };
  });
}
