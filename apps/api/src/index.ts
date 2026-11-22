import Fastify from "fastify";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { findFieldConflicts } from "./provenance";
import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { binaryVersion, latestRelease, updateStatus } from "./updates";
import { contactFilterClauses } from "./contactfilter";
import { createJob, personalize, runJob, sendDelayMs, type SendJob } from "./sendjob";
import { serviceState, startService, stopService, wahaKey } from "./waha";
import { findDuplicates, type DupeRow } from "./dupes";
import { parseCsv } from "./csv";
import { ensureGeoData, geoStatus, getCountry, listCities, listCountries, listStates } from "./geo";
import { MAX_CITIES_DEFAULT, MAX_CITIES_LIMIT, activeRunId, cancelScrape, listScrapes, resolveRunner, startScrape } from "./scraper";
import { IMPORT_SOURCE, createImportSession, importSessions, insertRows, type ImportRow, type ImportSession } from "./importer";
import { ensureMatchingSchema } from "./matching";

ensureMatchingSchema();
const app = Fastify({ logger: true, bodyLimit: Number.MAX_SAFE_INTEGER });
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4317);
const WAHA_BASE_URL = (process.env.WAHA_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const WAHA_SESSION = process.env.WAHA_SESSION || "default";
function normalizeWhatsAppNumber(value: string) { let digits = value.replace(/\D/g, ""); if (digits.startsWith("00")) digits = digits.slice(2); if (digits.startsWith("0")) digits = "92" + digits.slice(1); else if (digits.length === 10 && digits.startsWith("3")) digits = "92" + digits; return digits.length >= 8 && digits.length <= 15 ? digits : ""; }
function isLocalWahaUrl() { try { const url = new URL(WAHA_BASE_URL); return ["127.0.0.1","localhost","[::1]", ...(process.env.WAHA_ALLOWED_HOSTS || "").split(",").map(h => h.trim()).filter(Boolean)].includes(url.hostname) && ["http:","https:"].includes(url.protocol); } catch { return false; } }

app.get("/api/health", async () => ({ ok: true, app: "RumiReach", version: "0.3.0" }));

app.get("/api/candidates", async (request) => {
  const q = request.query as { page?: string; pageSize?: string; search?: string; category?: string; status?: string; sort?: string; collection?: string; has?: string };
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(q.pageSize) || 25)));
  const search = (q.search || "").trim().slice(0, 200);
  const category = (q.category || "").trim().slice(0, 100);
  const status = ["pending", "accepted", "contacted", "rejected", "needs_review"].includes(q.status || "") ? q.status! : "";
  const where = ["source_id = ?"];
  const params: (string | number)[] = [IMPORT_SOURCE];
  if (search) {
    where.push("(name LIKE ? OR category LIKE ? OR address LIKE ? OR phone_raw LIKE ? OR website_url LIKE ? OR public_email LIKE ?)");
    const term = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
    params.push(term, term, term, term, term, term);
  }
  if (category) { where.push("category = ?"); params.push(category); }
  if (q.collection) { where.push("job_id = ?"); params.push(q.collection.slice(0, 64)); }
  where.push(...contactFilterClauses(q.has));
  if (status) { where.push("review_status = ?"); params.push(status); }
  const clause = where.join(" AND ");
  const total = (db.prepare("SELECT COUNT(*) AS count FROM candidates WHERE " + clause).get(...params) as { count: number }).count;
  const order = q.sort === "name" ? "name COLLATE NOCASE ASC" : q.sort === "category" ? "category COLLATE NOCASE ASC" : "observed_at DESC";
  const items = db.prepare("SELECT c.id,c.job_id,c.source_object_type,c.source_object_id,c.name,c.category,c.address,c.phone_raw,c.website_url,c.public_email,c.source_url,c.observed_at,c.review_status FROM candidates c WHERE " + clause + " ORDER BY " + order + " LIMIT ? OFFSET ?").all(...params, pageSize, (page - 1) * pageSize);
  const categories = db.prepare("SELECT DISTINCT category FROM candidates WHERE source_id = ? AND category IS NOT NULL ORDER BY category COLLATE NOCASE").all(IMPORT_SOURCE) as Array<{ category: string }>;
  const stats = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN review_status='accepted' THEN 1 ELSE 0 END) AS accepted, SUM(CASE WHEN review_status='pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN phone_raw IS NOT NULL AND phone_raw != '' THEN 1 ELSE 0 END) AS withPhone, SUM(CASE WHEN website_url IS NOT NULL AND website_url != '' THEN 1 ELSE 0 END) AS withWebsite FROM candidates WHERE source_id = ?").get(IMPORT_SOURCE);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize), categories: categories.map(x => x.category), stats };
});

app.get("/api/candidates/export", async (request, reply) => {
  const q = request.query as { search?: string; category?: string; status?: string; sort?: string; collection?: string; has?: string };
  const search = (q.search || "").trim().slice(0, 200);
  const category = (q.category || "").trim().slice(0, 100);
  const status = ["pending", "accepted", "contacted", "rejected", "needs_review"].includes(q.status || "") ? q.status! : "";
  const where = ["source_id = ?"];
  const params: string[] = [IMPORT_SOURCE];
  if (search) {
    where.push("(name LIKE ? OR category LIKE ? OR address LIKE ? OR phone_raw LIKE ? OR website_url LIKE ? OR public_email LIKE ?)");
    const term = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
    params.push(term, term, term, term, term, term);
  }
  if (category) { where.push("category = ?"); params.push(category); }
  if (q.collection) { where.push("job_id = ?"); params.push(q.collection.slice(0, 64)); }
  where.push(...contactFilterClauses(q.has));
  if (status) { where.push("review_status = ?"); params.push(status); }
  const order = q.sort === "name" ? "name COLLATE NOCASE ASC" : q.sort === "category" ? "category COLLATE NOCASE ASC" : "observed_at DESC";
  const statement = db.prepare("SELECT name,category,address,phone_raw,website_url,public_email,source_url,review_status FROM candidates WHERE " + where.join(" AND ") + " ORDER BY " + order);
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  function* csvLines() {
    yield "\uFEFFname,category,address,phone,website,email,source_url,review_status\r\n";
    for (const row of statement.iterate(...params) as Iterable<Record<string, unknown>>) {
      yield [row.name,row.category,row.address,row.phone_raw,row.website_url,row.public_email,row.source_url,row.review_status].map(cell).join(",") + "\r\n";
    }
  }
  const collectionName = q.collection ? (db.prepare("SELECT COALESCE(NULLIF(name,''), locality) AS n FROM search_jobs WHERE id=?").get(q.collection.slice(0, 64)) as { n: string } | undefined)?.n : "";
  const fileBase = (collectionName || "rumireach-leads").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "rumireach-leads";
  return reply.type("text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="' + fileBase + '.csv"').send(Readable.from(csvLines()));
});

app.post("/api/import/csv/start", async (request, reply) => {
  const body = request.body as { filename?: string; name?: string };
  const filename = (body?.filename || "business-import.csv").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "business-import.csv";
  const name = (body?.name || "").replace(/\s+/g, " ").trim().slice(0, 100) || undefined;
  const session = createImportSession(filename, { name });
  const { batchId, jobId } = session;
  return { batchId, jobId, status: "running", nextRow: session.nextRow };
});

app.post("/api/import/csv/:batchId/batch", async (request, reply) => {
  const { batchId } = request.params as { batchId: string };
  const session = importSessions.get(batchId);
  if (!session || session.status !== "running") return reply.code(404).send({ error: "Import session not found or no longer active." });
  const body = request.body as { rows?: ImportRow[]; startRow?: number };
  if (!Array.isArray(body?.rows) || body.rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) return reply.code(400).send({ error: "Provide an array of CSV row objects." });
  const startRow = Number(body.startRow);
  if (!Number.isInteger(startRow) || startRow !== session.nextRow) return reply.code(409).send({ error: "Batch sequence mismatch. Expected row " + session.nextRow + "." });
  try {
    insertRows(session, body.rows, startRow);
    db.prepare("UPDATE search_jobs SET candidate_count = ? WHERE id = ?").run(session.imported, session.jobId);
    return { batchId, received: body.rows.length, nextRow: session.nextRow, imported: session.imported, skipped: session.skipped };
  } catch (error) {
    request.log.error(error, "CSV batch failed");
    session.status = "failed";
    db.prepare("UPDATE search_jobs SET status='failed',error_message=?,finished_at=? WHERE id=?").run("CSV batch failed.", new Date().toISOString(), session.jobId);
    return reply.code(500).send({ error: "CSV batch failed. Previously committed batches remain saved; check the directory before retrying." });
  }
});

app.post("/api/import/csv/:batchId/complete", async (request, reply) => {
  const { batchId } = request.params as { batchId: string };
  const session = importSessions.get(batchId);
  if (!session || session.status !== "running") return reply.code(404).send({ error: "Import session not found or no longer active." });
  session.status = "completed";
  db.prepare("UPDATE search_jobs SET status='completed',candidate_count=?,finished_at=? WHERE id=?").run(session.imported, new Date().toISOString(), session.jobId);
  importSessions.delete(batchId);
  return { batchId, jobId: session.jobId, filename: session.filename, status: "completed", imported: session.imported, skipped: session.skipped, invalidWebsite: session.invalidWebsite, notice: "Imported values are unverified. Review original source terms before reuse." };
});

app.post("/api/import/csv", async (request, reply) => {
  const body = request.body as { filename?: string; csv?: string };
  if (typeof body?.csv !== "string" || !body.csv.trim()) return reply.code(400).send({ error: "Provide CSV text in the csv field." });
  let rows: ImportRow[];
  try { rows = parseCsv(body.csv); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid CSV." }); }
  const started = await app.inject({ method: "POST", url: "/api/import/csv/start", payload: { filename: body.filename } });
  const session = started.json() as { batchId: string };
  const internal = importSessions.get(session.batchId)!;
  try {
    for (let offset = 0; offset < rows.length; offset += 500) insertRows(internal, rows.slice(offset, offset + 500), offset + 2);
    db.prepare("UPDATE search_jobs SET status='completed',candidate_count=?,finished_at=? WHERE id=?").run(internal.imported, new Date().toISOString(), internal.jobId);
    importSessions.delete(session.batchId);
    return { batchId: internal.batchId, jobId: internal.jobId, filename: internal.filename, status: "completed", imported: internal.imported, skipped: internal.skipped, invalidWebsite: internal.invalidWebsite, notice: "Imported values are unverified. Review original source terms before reuse." };
  } catch (error) {
    request.log.error(error, "CSV import failed");
    return reply.code(500).send({ error: "CSV import failed. Previously committed batches may remain saved." });
  }
});

// ---- Find leads: country/state/city pickers + local Google Maps scraper runs ----
function geoFailure(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: unknown) {
  return reply.code(503).send({ error: (error instanceof Error ? error.message : "Location data is unavailable.") + " Check your internet connection and try again." });
}

app.get("/api/scrape/status", async () => ({ runner: resolveRunner(), geo: geoStatus(), maxCities: MAX_CITIES_LIMIT, defaultCities: MAX_CITIES_DEFAULT }));

app.get("/api/geo/countries", async (_request, reply) => {
  try { return { countries: await listCountries() }; } catch (error) { return geoFailure(reply, error); }
});
app.get("/api/geo/countries/:country/states", async (request, reply) => {
  const { country } = request.params as { country: string };
  try {
    const states = await listStates(country.toUpperCase());
    return states ? { states } : reply.code(404).send({ error: "Unknown country." });
  } catch (error) { return geoFailure(reply, error); }
});
app.get("/api/geo/countries/:country/states/:state/cities", async (request, reply) => {
  const { country, state } = request.params as { country: string; state: string };
  try {
    const cities = await listCities(country.toUpperCase(), state);
    return cities ? { cities } : reply.code(404).send({ error: "Unknown state." });
  } catch (error) { return geoFailure(reply, error); }
});

const ScrapeBody = z.object({
  keywords: z.array(z.string().trim().min(2).max(80)).min(1).max(10),
  country: z.string().regex(/^[A-Za-z]{2}$/),
  state: z.string().max(20).optional(),
  city: z.string().trim().max(120).optional(),
  maxCities: z.number().int().min(1).max(MAX_CITIES_LIMIT).default(MAX_CITIES_DEFAULT),
  depth: z.number().int().min(1).max(20).default(5),
  email: z.boolean().default(false),
  name: z.string().trim().max(100).optional(),
  lang: z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/).default("en"),
  authorized: z.literal(true, { error: "Confirm that you are authorized to collect and use this data." })
});

app.post("/api/scrape/runs", async (request, reply) => {
  const parsed = ScrapeBody.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map(issue => issue.message).join(" ") });
  const body = parsed.data;
  if (activeRunId()) return reply.code(409).send({ error: "Another scrape is already running. Wait for it to finish or cancel it." });
  let country;
  try { country = await getCountry(body.country.toUpperCase()); } catch (error) { return geoFailure(reply, error); }
  if (!country) return reply.code(400).send({ error: "Unknown country." });
  let state: { id: string; name: string; cities: string[] } | undefined;
  if (body.state) {
    state = country.states.find(item => item.id === body.state);
    if (!state) return reply.code(400).send({ error: "Unknown state for the selected country." });
  }
  let cities: string[] = [];
  if (body.city) {
    if (state && !state.cities.includes(body.city)) return reply.code(400).send({ error: "That city is not in the selected state." });
    cities = [body.city];
  } else if (state) cities = state.cities.slice(0, body.maxCities);
  try {
    const req = { keywords: body.keywords, countryName: country.name, stateName: state?.name, cities, depth: body.depth, email: body.email, lang: body.lang };
    const meta = { country: country.name, state: state?.name, city: body.city };
    const run = await startScrape(req, { ...meta, name: body.name, request: { req, meta } });
    return reply.code(202).send({ ...run, cities: cities.length });
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not start the scrape." });
  }
});

app.get("/api/scrape/runs", async () => ({ runs: listScrapes() }));

app.post("/api/scrape/runs/:id/cancel", async (request, reply) => {
  const { id } = request.params as { id: string };
  return cancelScrape(id) ? { ok: true } : reply.code(404).send({ error: "That scrape is not running." });
});


app.post("/api/scrape/runs/:id/rerun", async (request, reply) => {
  const { id } = request.params as { id: string };
  const row = db.prepare("SELECT name,request_json FROM scrape_runs WHERE id=?").get(id) as { name: string | null; request_json: string | null } | undefined;
  if (!row?.request_json) return reply.code(404).send({ error: "That run cannot be repeated." });
  if (activeRunId()) return reply.code(409).send({ error: "Another scrape is already running. Wait for it to finish or cancel it." });
  const saved = JSON.parse(row.request_json) as { req: Parameters<typeof startScrape>[0]; meta: Parameters<typeof startScrape>[1] };
  try { return reply.code(202).send(await startScrape(saved.req, { ...saved.meta, name: (row.name || "Search") + " (again)", request: saved })); }
  catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not start the scrape." }); }
});

// ---- Collections: every import / scrape is saved as a named, renameable, deletable list ----
app.get("/api/collections", async () => {
  const rows = db.prepare("SELECT j.id, COALESCE(NULLIF(j.name,''), j.locality) AS name, j.locality AS filename, j.category, j.city AS place, j.status, j.created_at AS createdAt, (SELECT COUNT(*) FROM candidates c WHERE c.job_id=j.id) AS count, (SELECT COUNT(*) FROM candidates c WHERE c.job_id=j.id AND c.review_status='accepted') AS accepted FROM search_jobs j WHERE j.source_id=? ORDER BY j.created_at DESC").all(IMPORT_SOURCE) as Array<{ filename: string }>;
  return { collections: rows.map(row => ({ ...row, type: row.filename.startsWith("gmaps-scrape-") ? "search" : "csv" })) };
});
app.patch("/api/collections/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const name = String((request.body as { name?: string })?.name || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!name) return reply.code(400).send({ error: "Enter a name." });
  const result = db.prepare("UPDATE search_jobs SET name=? WHERE id=? AND source_id=?").run(name, id, IMPORT_SOURCE);
  if (!result.changes) return reply.code(404).send({ error: "Collection not found." });
  db.prepare("UPDATE scrape_runs SET name=? WHERE import_job_id=?").run(name, id);
  return { ok: true };
});
app.post("/api/collections/:id/merge", async (request, reply) => {
  const { id } = request.params as { id: string };
  const into = String((request.body as { into?: string })?.into || "");
  if (!into || into === id) return reply.code(400).send({ error: "Choose a different collection to merge into." });
  const exists = db.prepare("SELECT id FROM search_jobs WHERE id=? AND source_id=?");
  if (!exists.get(id, IMPORT_SOURCE) || !exists.get(into, IMPORT_SOURCE)) return reply.code(404).send({ error: "Collection not found." });
  const moved = db.transaction(() => {
    const result = db.prepare("UPDATE candidates SET job_id=? WHERE job_id=?").run(into, id);
    db.prepare("UPDATE scrape_runs SET import_job_id=? WHERE import_job_id=?").run(into, id);
    db.prepare("DELETE FROM search_jobs WHERE id=? AND source_id=?").run(id, IMPORT_SOURCE);
    db.prepare("UPDATE search_jobs SET candidate_count=(SELECT COUNT(*) FROM candidates WHERE job_id=?) WHERE id=?").run(into, into);
    return result.changes;
  })();
  return { ok: true, moved };
});
app.delete("/api/collections/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const deleted = db.transaction(() => {
    const removed = (db.prepare("SELECT COUNT(*) AS n FROM candidates WHERE job_id=?").get(id) as { n: number }).n;
    const result = db.prepare("DELETE FROM search_jobs WHERE id=? AND source_id=?").run(id, IMPORT_SOURCE);
    if (result.changes) db.prepare("UPDATE scrape_runs SET import_job_id=NULL WHERE import_job_id=?").run(id);
    return result.changes ? removed : -1;
  })();
  return deleted < 0 ? reply.code(404).send({ error: "Collection not found." }) : { ok: true, removed: deleted };
});
app.post("/api/candidates/bulk", async (request, reply) => {
  const body = request.body as { ids?: unknown; action?: string };
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length <= 64))] : [];
  if (!ids.length || ids.length > 500) return reply.code(400).send({ error: "Select between 1 and 500 businesses." });
  const action = body?.action || "";
  if (!["accepted", "contacted", "rejected", "needs_review", "pending", "delete"].includes(action)) return reply.code(400).send({ error: "Unknown action." });
  const marks = ids.map(() => "?").join(",");
  const changed = db.transaction(() => action === "delete"
    ? db.prepare("DELETE FROM candidates WHERE source_id=? AND id IN (" + marks + ")").run(IMPORT_SOURCE, ...ids).changes
    : db.prepare("UPDATE candidates SET review_status=? WHERE source_id=? AND id IN (" + marks + ")").run(action, IMPORT_SOURCE, ...ids).changes)();
  return { ok: true, changed };
});

function loadDupes() {
  const rows = db.prepare("SELECT id,name,address,phone_raw,review_status,observed_at FROM candidates WHERE source_id=?").all(IMPORT_SOURCE) as DupeRow[];
  return findDuplicates(rows);
}
app.get("/api/duplicates", async () => { const { groups, remove } = loadDupes(); return { groups, removable: remove.length }; });
app.post("/api/duplicates/remove", async () => {
  const { remove } = loadDupes();
  const del = db.prepare("DELETE FROM candidates WHERE id=? AND source_id=?");
  db.transaction(() => { for (const id of remove) del.run(id, IMPORT_SOURCE); })();
  return { ok: true, removed: remove.length };
});

app.delete("/api/candidates/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  return db.prepare("DELETE FROM candidates WHERE id=? AND source_id=?").run(id, IMPORT_SOURCE).changes ? { ok: true } : reply.code(404).send({ error: "Business not found." });
});

async function wahaCall(path: string, init: RequestInit = {}) {
  return fetch(WAHA_BASE_URL + path, { ...init, headers: { "X-Api-Key": wahaKey(), "Content-Type": "application/json", Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
}
/** When the session first reported STARTING; used to detect a session that never finishes booting. */
let startingSince: number | null = null;
let lastAutoReset = 0;
const STUCK_AFTER_MS = 75_000;
const AUTO_RESET_COOLDOWN_MS = 5 * 60_000;

async function sessionStatus(): Promise<string> {
  try {
    const response = await wahaCall("/api/sessions?all=true");
    if (!response.ok) return "UNAUTHORIZED";
    const sessions = await response.json() as Array<{ name?: string; status?: string }>;
    const status = sessions.find(item => item.name === WAHA_SESSION)?.status || "NOT_FOUND";
    if (status === "STARTING") startingSince ??= Date.now(); else startingSince = null;
    return status;
  } catch { return "UNREACHABLE"; }
}
const startingSeconds = () => startingSince ? Math.round((Date.now() - startingSince) / 1000) : 0;

/** Deletes a (possibly wedged or stale-engine) session and creates a fresh one so WAHA produces a new QR code. */
async function resetSession() {
  await wahaCall("/api/sessions/" + encodeURIComponent(WAHA_SESSION) + "/stop", { method: "POST", body: JSON.stringify({ logout: false }) }).catch(() => undefined);
  await wahaCall("/api/sessions/" + encodeURIComponent(WAHA_SESSION), { method: "DELETE" }).catch(() => undefined);
  startingSince = null;
  await wahaCall("/api/sessions", { method: "POST", body: JSON.stringify({ name: WAHA_SESSION, start: true }) });
}

// ---- Update check (runs only when the user clicks "Check for updates") ----
app.get("/api/updates", async () => {
  const runner = resolveRunner();
  const inDocker = process.env.RUMIREACH_WAHA_EXTERNAL === "true";
  const [scraperLatest, wahaLatest, scraperInstalled, wahaInstalled] = await Promise.all([
    latestRelease("gosom/google-maps-scraper"),
    latestRelease("devlikeapro/waha"),
    runner.mode === "binary" && runner.path ? binaryVersion(runner.path) : Promise.resolve(null),
    (async () => {
      if (!wahaKey() || !isLocalWahaUrl()) return null;
      try { const response = await wahaCall("/api/version"); if (!response.ok) return null; const data = await response.json() as { version?: string }; return data.version || null; } catch { return null; }
    })()
  ]);
  const item = (id: string, name: string, installed: string | null, latest: { version: string; url: string } | null, command: string) =>
    ({ id, name, installed, latest: latest?.version || null, url: latest?.url || null, status: updateStatus(installed, latest?.version || null), command });
  return {
    checkedAt: new Date().toISOString(),
    items: [
      item("scraper", "Google Maps scraper", scraperInstalled, scraperLatest, inDocker ? "docker compose build --pull && docker compose up -d" : runner.mode === "docker" ? "docker pull gosom/google-maps-scraper" : "npm run build:scraper (after updating services/gmaps-scraper)"),
      item("waha", "WhatsApp service (WAHA)", wahaInstalled, wahaLatest, inDocker ? "docker compose pull && docker compose up -d" : "docker pull devlikeapro/waha, then stop and start the service")
    ]
  };
});

app.get("/api/whatsapp/service", async () => {
  const state = await serviceState();
  const session = state.container === "running" && wahaKey() && isLocalWahaUrl() ? await sessionStatus() : "";
  // A session that sits in STARTING for over a minute is wedged (typically a stale browser-engine session): rebuild it once, automatically.
  let autoRecovering = false;
  if (session === "STARTING" && startingSeconds() * 1000 > STUCK_AFTER_MS && Date.now() - lastAutoReset > AUTO_RESET_COOLDOWN_MS) {
    lastAutoReset = Date.now(); autoRecovering = true;
    void resetSession().catch(() => undefined);
  }
  return { ...state, session, localOnly: isLocalWahaUrl(), startingSeconds: startingSeconds(), stuck: session === "STARTING" && startingSeconds() * 1000 > STUCK_AFTER_MS, autoRecovering };
});
app.post("/api/whatsapp/service/start", async (_request, reply) => {
  if (!isLocalWahaUrl()) return reply.code(400).send({ error: "WAHA_BASE_URL points outside this computer; start that WAHA yourself." });
  return reply.code(202).send({ started: startService() });
});
app.post("/api/whatsapp/service/stop", async (_request, reply) => {
  try { await stopService(); return { ok: true }; } catch { return reply.code(500).send({ error: "Could not stop the WhatsApp service." }); }
});
// Create/start the WhatsApp session so a QR code is produced.
app.post("/api/whatsapp/session/start", async (_request, reply) => {
  if (!wahaKey() || !isLocalWahaUrl()) return reply.code(503).send({ error: "Start the WhatsApp service first." });
  try {
    const status = await sessionStatus();
    if (status === "NOT_FOUND") await wahaCall("/api/sessions", { method: "POST", body: JSON.stringify({ name: WAHA_SESSION, start: true }) });
    else if (status === "STOPPED" || status === "FAILED") await wahaCall("/api/sessions/" + encodeURIComponent(WAHA_SESSION) + "/start", { method: "POST" });
    return { status: await sessionStatus() };
  } catch { return reply.code(502).send({ error: "Cannot reach WAHA yet. Wait a few seconds and try again." }); }
});
// Rebuild the WhatsApp session from scratch (fixes a session stuck in STARTING). Pairing is needed again afterwards.
app.post("/api/whatsapp/session/reset", async (_request, reply) => {
  if (!wahaKey() || !isLocalWahaUrl()) return reply.code(503).send({ error: "Start the WhatsApp service first." });
  try { await resetSession(); return { status: await sessionStatus() }; }
  catch { return reply.code(502).send({ error: "Cannot reach WAHA yet. Wait a few seconds and try again." }); }
});
app.get("/api/whatsapp/qr", async (_request, reply) => {
  if (!wahaKey() || !isLocalWahaUrl()) return reply.code(503).send({ error: "Start the WhatsApp service first." });
  try {
    const response = await wahaCall("/api/" + encodeURIComponent(WAHA_SESSION) + "/auth/qr?format=image");
    if (!response.ok) return reply.code(409).send({ error: "No QR code available right now." });
    const data = await response.json() as { mimetype?: string; data?: string };
    if (!data.data) return reply.code(409).send({ error: "No QR code available right now." });
    return { image: "data:" + (data.mimetype || "image/png") + ";base64," + data.data };
  } catch { return reply.code(502).send({ error: "Cannot reach WAHA." }); }
});

function waStatusMessage(status?: string) {
  switch (status) {
    case "WORKING": return "WhatsApp session is connected.";
    case "SCAN_QR_CODE": return "Scan the QR code below with WhatsApp → Linked devices to connect.";
    case "STARTING": return "WhatsApp session is starting… this usually takes under a minute.";
    case "FAILED": return "WhatsApp session failed. Use “Reset session” below.";
    case "STOPPED": return "WhatsApp session is stopped. It will be started automatically.";
    default: return "WhatsApp is not paired yet. Open the One-click WhatsApp service below to start and scan the QR code.";
  }
}
app.get("/api/whatsapp/status", async () => {
  if (!wahaKey() || !isLocalWahaUrl()) return { configured: false, connected: false, message: "Start the WhatsApp service from the integration settings." };
  try { const response = await fetch(WAHA_BASE_URL + "/api/sessions", { headers: { "X-Api-Key": wahaKey() }, signal: AbortSignal.timeout(5000) }); if (!response.ok) return { configured: true, connected: false, message: "WAHA rejected the API request." }; const sessions = await response.json() as Array<{ name?: string; status?: string }>; const session = sessions.find(item => item.name === WAHA_SESSION); return { configured: true, connected: session?.status === "WORKING", session: WAHA_SESSION, sessionStatus: session?.status || "NOT_FOUND", message: waStatusMessage(session?.status) }; } catch { return { configured: true, connected: false, message: "Cannot reach WAHA. Start the service and try again." }; }
});
// ---- WhatsApp sending via WAHA: select businesses, press one button, a queue sends them one by one ----
const SEND_GAP_SECONDS = Math.max(5, Number(process.env.RUMIREACH_SEND_GAP_SECONDS) || 20);
type OutreachImage = { mimetype: string; filename: string; data: string };
function parseOutreachImage(input: { data?: string; mimetype?: string; filename?: string } | undefined): { image?: OutreachImage; error?: string; code?: number } {
  if (!input) return {};
  const mimetype = input.mimetype || "";
  const data = (input.data || "").replace(/\s/g, "");
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimetype) || !data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return { error: "Image must be a valid JPG, PNG or WebP file.", code: 400 };
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < 1 || bytes.length > 5 * 1024 * 1024) return { error: "Image must be 5 MB or smaller.", code: 413 };
  const isJpeg = mimetype === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = mimetype === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isWebp = mimetype === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!isJpeg && !isPng && !isWebp) return { error: "Image content does not match its declared file type.", code: 400 };
  return { image: { mimetype, data, filename: (input.filename || "rumireach-outreach-image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "rumireach-outreach-image" } };
}

let currentJob: SendJob | null = null;
let cancelRequested = false;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

app.post("/api/whatsapp/send", async (request, reply) => {
  const body = request.body as { ids?: string[]; template?: string; image?: { data?: string; mimetype?: string; filename?: string } };
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter(id => typeof id === "string"))] : [];
  const template = (body?.template || "").trim();
  if (!ids.length) return reply.code(400).send({ error: "Select at least one business." });
  if (ids.length > 500) return reply.code(400).send({ error: "Send to at most 500 businesses at a time." });
  if (!template || template.length > 4096) return reply.code(400).send({ error: "Message must contain 1–4096 characters." });
  if (currentJob?.state === "running") return reply.code(409).send({ error: "A send is already running. Wait for it to finish or cancel it." });
  if (!wahaKey() || !isLocalWahaUrl()) return reply.code(503).send({ error: "WhatsApp is not set up. Start the WhatsApp service in the integration settings." });
  if (await sessionStatus() !== "WORKING") return reply.code(409).send({ error: "WhatsApp is not connected. Scan the QR code in the integration settings first." });
  const parsed = parseOutreachImage(body.image); if (parsed.error) return reply.code(parsed.code || 400).send({ error: parsed.error });
  const image = parsed.image;

  type Row = { id: string; name: string | null; category: string | null; phone_raw: string | null };
  const lookup = db.prepare("SELECT id,name,category,phone_raw FROM candidates WHERE id=? AND source_id=?");
  const rows = new Map<string, Row>();
  for (const id of ids) { const row = lookup.get(id, IMPORT_SOURCE) as Row | undefined; if (row) rows.set(id, row); }
  if (!rows.size) return reply.code(404).send({ error: "None of the selected businesses were found." });

  const job = createJob(randomUUID(), [...rows.values()].map(row => ({ id: row.id, name: row.name || "Unnamed business" })));
  currentJob = job; cancelRequested = false;
  const logSend = db.prepare("INSERT INTO whatsapp_send_log (id,candidate_id,phone_e164,provider_message_id,status,error_message,sent_at) VALUES (?,?,?,?,?,?,?)");
  const markContacted = db.prepare("UPDATE candidates SET review_status='contacted' WHERE id=?");

  void runJob(job, async item => {
    const row = rows.get(item.id)!;
    const phone = normalizeWhatsAppNumber(row.phone_raw || "");
    if (!phone) return { status: "skipped", note: "No usable phone number" };
    const now = new Date();
    const text = personalize(template, row.name, row.category);
    try {
      const payload = image ? { session: WAHA_SESSION, chatId: phone + "@c.us", file: image, caption: text } : { session: WAHA_SESSION, chatId: phone + "@c.us", text };
      const response = await fetch(WAHA_BASE_URL + (image ? "/api/sendImage" : "/api/sendText"), { method: "POST", headers: { "X-Api-Key": wahaKey(), "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
      const result = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: string };
      if (!response.ok) { const note = String(result.message || result.error || "WAHA rejected the message").slice(0, 200); logSend.run(randomUUID(), item.id, phone, null, "failed", note, now.toISOString()); return { status: "failed", note }; }
      logSend.run(randomUUID(), item.id, phone, result.id || null, "sent", null, now.toISOString()); markContacted.run(item.id);
      return { status: "sent" };
    } catch { return { status: "failed", note: "Could not reach WhatsApp service" }; }
  }, { gapMs: () => sendDelayMs(SEND_GAP_SECONDS), sleep, cancelled: () => cancelRequested }).catch(() => { job.state = "done"; });
  return reply.code(202).send(job);
});
app.get("/api/whatsapp/send/current", async () => ({ job: currentJob, gapSeconds: SEND_GAP_SECONDS }));
app.post("/api/whatsapp/send/cancel", async () => { cancelRequested = true; return { ok: true }; });
app.get("/api/profiles", async () => db.prepare("SELECT p.id,p.canonical_name,p.category,p.address,p.phone_raw,p.website_url,p.public_email,p.created_at,p.updated_at,COUNT(s.candidate_id) AS source_count FROM business_profiles p LEFT JOIN business_profile_sources s ON s.profile_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 500").all());
app.get("/api/candidates/:id/provenance", async (request, reply) => {
  const params = request.params as { id: string };
  const candidate = db.prepare("SELECT id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at FROM candidates WHERE id=?").get(params.id);
  if (!candidate) return reply.code(404).send({ error: "Candidate not found." });
  const observations = db.prepare("SELECT id,field_name,field_value,source_id,source_url,observed_at,source_timestamp,verification_status,confidence FROM field_observations WHERE candidate_id=? ORDER BY field_name,observed_at DESC").all(params.id) as Array<{ field_name: string; field_value: string }>;
  return { candidate, observations, conflicts: findFieldConflicts(observations) };
});
app.patch("/api/candidates/:id/review", async (request, reply) => {
  const params = request.params as { id: string }, body = request.body as { status?: string };
  if (!["accepted", "contacted", "rejected", "needs_review", "pending"].includes(body?.status || "")) return reply.code(400).send({ error: "Invalid review status." });
  const result = db.prepare("UPDATE candidates SET review_status=? WHERE id=? AND source_id=?").run(body.status, params.id, IMPORT_SOURCE);
  if (!result.changes) return reply.code(404).send({ error: "Candidate not found." });
  return { ok: true };
});

// Production / Docker: serve the built dashboard from the same port as the API.
const webDir = process.env.RUMIREACH_WEB_DIR || join(__dirname, "..", "..", "web", "dist");
if (existsSync(join(webDir, "index.html"))) app.register(fastifyStatic, { root: webDir });

app.listen({ host: HOST, port: PORT }).catch(error => { app.log.error(error); process.exit(1); });
