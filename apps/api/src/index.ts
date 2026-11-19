import Fastify from "fastify";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { findFieldConflicts } from "./provenance";
import { z } from "zod";
import { parseCsv } from "./csv";
import { ensureGeoData, geoStatus, getCountry, listCities, listCountries, listStates } from "./geo";
import { MAX_CITIES_DEFAULT, MAX_CITIES_LIMIT, activeRunId, cancelScrape, listScrapes, resolveRunner, startScrape } from "./scraper";
import { IMPORT_SOURCE, createImportSession, importSessions, insertRows, type ImportRow, type ImportSession } from "./importer";
import { ensureMatchingSchema } from "./matching";

ensureMatchingSchema();
const app = Fastify({ logger: true, bodyLimit: Number.MAX_SAFE_INTEGER });
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4317);
const WAHA_BASE_URL = (process.env.WAHA_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const WAHA_SESSION = process.env.WAHA_SESSION || "default";
const WAHA_API_KEY = process.env.WAHA_API_KEY || "";
function normalizeWhatsAppNumber(value: string) { let digits = value.replace(/\D/g, ""); if (digits.startsWith("00")) digits = digits.slice(2); if (digits.startsWith("0")) digits = "92" + digits.slice(1); else if (digits.length === 10 && digits.startsWith("3")) digits = "92" + digits; return digits.length >= 8 && digits.length <= 15 ? digits : ""; }
function isLocalWahaUrl() { try { const url = new URL(WAHA_BASE_URL); return ["127.0.0.1","localhost","[::1]"].includes(url.hostname) && ["http:","https:"].includes(url.protocol); } catch { return false; } }

app.get("/api/health", async () => ({ ok: true, app: "RumiReach", version: "0.3.0" }));

app.get("/api/candidates", async (request) => {
  const q = request.query as { page?: string; pageSize?: string; search?: string; category?: string; status?: string; sort?: string; collection?: string; has?: string };
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(q.pageSize) || 25)));
  const search = (q.search || "").trim().slice(0, 200);
  const category = (q.category || "").trim().slice(0, 100);
  const status = ["pending", "accepted", "rejected", "needs_review"].includes(q.status || "") ? q.status! : "";
  const where = ["source_id = ?"];
  const params: (string | number)[] = [IMPORT_SOURCE];
  if (search) {
    where.push("(name LIKE ? OR category LIKE ? OR address LIKE ? OR phone_raw LIKE ? OR website_url LIKE ? OR public_email LIKE ?)");
    const term = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
    params.push(term, term, term, term, term, term);
  }
  if (category) { where.push("category = ?"); params.push(category); }
  if (q.collection) { where.push("job_id = ?"); params.push(q.collection.slice(0, 64)); }
  const hasColumn = ({ phone: "phone_raw", website: "website_url", email: "public_email" } as Record<string, string>)[q.has || ""];
  if (hasColumn) where.push("COALESCE(" + hasColumn + ", '') != ''");
  if (status) { where.push("review_status = ?"); params.push(status); }
  const clause = where.join(" AND ");
  const total = (db.prepare("SELECT COUNT(*) AS count FROM candidates WHERE " + clause).get(...params) as { count: number }).count;
  const order = q.sort === "name" ? "name COLLATE NOCASE ASC" : q.sort === "category" ? "category COLLATE NOCASE ASC" : "observed_at DESC";
  const items = db.prepare("SELECT c.id,c.job_id,c.source_object_type,c.source_object_id,c.name,c.category,c.address,c.phone_raw,c.website_url,c.public_email,c.source_url,c.observed_at,c.review_status,COALESCE(w.status, 'not_confirmed') AS whatsapp_consent_status,w.consent_at AS whatsapp_consent_at FROM candidates c LEFT JOIN whatsapp_consents w ON w.candidate_id=c.id WHERE " + clause + " ORDER BY " + order + " LIMIT ? OFFSET ?").all(...params, pageSize, (page - 1) * pageSize);
  const categories = db.prepare("SELECT DISTINCT category FROM candidates WHERE source_id = ? AND category IS NOT NULL ORDER BY category COLLATE NOCASE").all(IMPORT_SOURCE) as Array<{ category: string }>;
  const stats = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN review_status='accepted' THEN 1 ELSE 0 END) AS accepted, SUM(CASE WHEN review_status='pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN phone_raw IS NOT NULL AND phone_raw != '' THEN 1 ELSE 0 END) AS withPhone, SUM(CASE WHEN website_url IS NOT NULL AND website_url != '' THEN 1 ELSE 0 END) AS withWebsite FROM candidates WHERE source_id = ?").get(IMPORT_SOURCE);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize), categories: categories.map(x => x.category), stats };
});

app.get("/api/candidates/export", async (request, reply) => {
  const q = request.query as { search?: string; category?: string; status?: string; sort?: string; collection?: string; has?: string };
  const search = (q.search || "").trim().slice(0, 200);
  const category = (q.category || "").trim().slice(0, 100);
  const status = ["pending", "accepted", "rejected", "needs_review"].includes(q.status || "") ? q.status! : "";
  const where = ["source_id = ?"];
  const params: string[] = [IMPORT_SOURCE];
  if (search) {
    where.push("(name LIKE ? OR category LIKE ? OR address LIKE ? OR phone_raw LIKE ? OR website_url LIKE ? OR public_email LIKE ?)");
    const term = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
    params.push(term, term, term, term, term, term);
  }
  if (category) { where.push("category = ?"); params.push(category); }
  if (q.collection) { where.push("job_id = ?"); params.push(q.collection.slice(0, 64)); }
  const hasColumn = ({ phone: "phone_raw", website: "website_url", email: "public_email" } as Record<string, string>)[q.has || ""];
  if (hasColumn) where.push("COALESCE(" + hasColumn + ", '') != ''");
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
  if (!["accepted", "rejected", "needs_review", "pending", "delete"].includes(action)) return reply.code(400).send({ error: "Unknown action." });
  const marks = ids.map(() => "?").join(",");
  const changed = db.transaction(() => action === "delete"
    ? db.prepare("DELETE FROM candidates WHERE source_id=? AND id IN (" + marks + ")").run(IMPORT_SOURCE, ...ids).changes
    : db.prepare("UPDATE candidates SET review_status=? WHERE source_id=? AND id IN (" + marks + ")").run(action, IMPORT_SOURCE, ...ids).changes)();
  return { ok: true, changed };
});

app.delete("/api/candidates/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  return db.prepare("DELETE FROM candidates WHERE id=? AND source_id=?").run(id, IMPORT_SOURCE).changes ? { ok: true } : reply.code(404).send({ error: "Business not found." });
});

app.get("/api/whatsapp/status", async () => {
  if (!WAHA_API_KEY || !isLocalWahaUrl()) return { configured: false, connected: false, message: "Set localhost WAHA_BASE_URL and WAHA_API_KEY in the API environment." };
  try { const response = await fetch(WAHA_BASE_URL + "/api/sessions", { headers: { "X-Api-Key": WAHA_API_KEY }, signal: AbortSignal.timeout(5000) }); if (!response.ok) return { configured: true, connected: false, message: "WAHA rejected the API request." }; const sessions = await response.json() as Array<{ name?: string; status?: string }>; const session = sessions.find(item => item.name === WAHA_SESSION); return { configured: true, connected: session?.status === "WORKING", session: WAHA_SESSION, sessionStatus: session?.status || "NOT_FOUND", message: session?.status === "WORKING" ? "WhatsApp session is connected." : "Pair/start the WAHA session using its QR dashboard." }; } catch { return { configured: true, connected: false, message: "Cannot reach WAHA. Start the service and try again." }; }
});
app.patch("/api/candidates/:id/whatsapp-consent", async (request, reply) => {
  const { id } = request.params as { id: string }; const body = request.body as { status?: string; evidence?: string; method?: string };
  if (!["opted_in", "opted_out"].includes(body?.status || "")) return reply.code(400).send({ error: "Consent status must be opted_in or opted_out." });
  const candidate = db.prepare("SELECT id,phone_raw FROM candidates WHERE id=? AND source_id=?").get(id, IMPORT_SOURCE) as { id: string; phone_raw: string | null } | undefined;
  if (!candidate) return reply.code(404).send({ error: "Candidate not found." }); const phone = normalizeWhatsAppNumber(candidate.phone_raw || ""); if (!phone) return reply.code(400).send({ error: "A valid phone number is required." });
  const evidence = (body.evidence || "").trim().slice(0, 500); if (body.status === "opted_in" && evidence.length < 5) return reply.code(400).send({ error: "Record how and when the contact gave permission (at least 5 characters)." });
  const now = new Date().toISOString(); db.prepare("INSERT INTO whatsapp_consents (candidate_id,phone_e164,status,consent_method,consent_evidence,consent_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(candidate_id) DO UPDATE SET phone_e164=excluded.phone_e164,status=excluded.status,consent_method=excluded.consent_method,consent_evidence=excluded.consent_evidence,consent_at=excluded.consent_at,updated_at=excluded.updated_at").run(id, phone, body.status, (body.method || "operator_attestation").slice(0, 50), body.status === "opted_in" ? evidence : null, now, now); return { ok: true, status: body.status, phone, consentAt: now };
});
app.post("/api/candidates/:id/whatsapp-send", async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { message?: string; image?: { data?: string; mimetype?: string; filename?: string } };
  const message = (body?.message || "").trim();
  if (!message || message.length > 4096) return reply.code(400).send({ error: "Message must contain 1–4096 characters." });
  let imagePayload: { mimetype: string; filename: string; data: string } | null = null;
  if (body?.image) {
    const mimetype = body.image.mimetype || "";
    const data = (body.image.data || "").replace(/\s/g, "");
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(mimetype) || !data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
      return reply.code(400).send({ error: "Image must be a valid JPG, PNG or WebP file." });
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.length < 1 || bytes.length > 5 * 1024 * 1024) return reply.code(413).send({ error: "Image must be 5 MB or smaller." });
    const isJpeg = mimetype === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = mimetype === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const isWebp = mimetype === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!isJpeg && !isPng && !isWebp) return reply.code(400).send({ error: "Image content does not match its declared file type." });
    const filename = (body.image.filename || "rumireach-outreach-image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "rumireach-outreach-image";
    imagePayload = { mimetype, filename, data };
  }
  if (!WAHA_API_KEY || !isLocalWahaUrl()) return reply.code(503).send({ error: "WAHA is not configured. Set localhost WAHA_BASE_URL and WAHA_API_KEY." });
  const candidate = db.prepare("SELECT id,phone_raw FROM candidates WHERE id=? AND source_id=?").get(id, IMPORT_SOURCE) as { id: string; phone_raw: string | null } | undefined; if (!candidate) return reply.code(404).send({ error: "Candidate not found." });
  const phone = normalizeWhatsAppNumber(candidate.phone_raw || ""); const consent = db.prepare("SELECT phone_e164,status,consent_evidence FROM whatsapp_consents WHERE candidate_id=?").get(id) as { phone_e164: string; status: string; consent_evidence: string | null } | undefined;
  if (!consent || consent.status !== "opted_in" || !consent.consent_evidence) return reply.code(403).send({ error: "Explicit opt-in evidence is required. Sending blocked." }); if (!phone || phone !== consent.phone_e164) return reply.code(409).send({ error: "Phone changed since consent. Reconfirm consent for this number." });
  const now = new Date(), dayStart = new Date(now); dayStart.setHours(0,0,0,0); const sentToday = (db.prepare("SELECT COUNT(*) AS count FROM whatsapp_send_log WHERE status=\"sent\" AND sent_at>=?").get(dayStart.toISOString()) as { count: number }).count;
  if (sentToday >= 20) return reply.code(429).send({ error: "Local safety ceiling reached: 20 sends per day." }); const lastSend = db.prepare("SELECT sent_at FROM whatsapp_send_log WHERE status=\"sent\" ORDER BY sent_at DESC LIMIT 1").get() as { sent_at: string } | undefined;
  if (lastSend && now.getTime() - Date.parse(lastSend.sent_at) < 30000) return reply.code(429).send({ error: "Wait at least 30 seconds between messages." }); const duplicate = db.prepare("SELECT id FROM whatsapp_send_log WHERE candidate_id=? AND status=\"sent\" AND sent_at>=? LIMIT 1").get(id, new Date(now.getTime()-86400000).toISOString()); if (duplicate) return reply.code(409).send({ error: "A message was already sent to this contact in the last 24 hours." });
  try {
    const endpoint = imagePayload ? "/api/sendImage" : "/api/sendText";
    const payload = imagePayload
      ? { session: WAHA_SESSION, chatId: phone + "@c.us", file: imagePayload, caption: message }
      : { session: WAHA_SESSION, chatId: phone + "@c.us", text: message };
    const response = await fetch(WAHA_BASE_URL + endpoint, { method: "POST", headers: { "X-Api-Key": WAHA_API_KEY, "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
    const result = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: string };
    if (!response.ok) { db.prepare("INSERT INTO whatsapp_send_log (id,candidate_id,phone_e164,status,error_message,sent_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), id, phone, "failed", String(result.message || result.error || "WAHA request failed").slice(0,500), now.toISOString()); return reply.code(502).send({ error: "WAHA could not send the message. Check the WAHA session." }); }
    db.prepare("INSERT INTO whatsapp_send_log (id,candidate_id,phone_e164,provider_message_id,status,sent_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), id, phone, result.id || null, "sent", now.toISOString()); return { ok: true, status: "sent", providerMessageId: result.id || null, sentAt: now.toISOString() };
  } catch { return reply.code(502).send({ error: "Could not reach WAHA. No successful send was recorded." }); }
});
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
  if (!["accepted", "rejected", "needs_review", "pending"].includes(body?.status || "")) return reply.code(400).send({ error: "Invalid review status." });
  const result = db.prepare("UPDATE candidates SET review_status=? WHERE id=? AND source_id=?").run(body.status, params.id, IMPORT_SOURCE);
  if (!result.changes) return reply.code(404).send({ error: "Candidate not found." });
  return { ok: true };
});

app.listen({ host: HOST, port: PORT }).catch(error => { app.log.error(error); process.exit(1); });
