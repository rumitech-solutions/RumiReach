import Fastify from "fastify";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { findFieldConflicts } from "./provenance";
import { normalizeSourceUrl, normalizeWebsite, parseCsv } from "./csv";
import { ensureMatchingSchema } from "./matching";

ensureMatchingSchema();
const app = Fastify({ logger: true, bodyLimit: Number.MAX_SAFE_INTEGER });
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4317);
const IMPORT_SOURCE = "user_csv_import";

type ImportRow = Record<string, string>;
type ImportSession = { batchId: string; jobId: string; filename: string; nextRow: number; imported: number; skipped: number; invalidWebsite: number; status: "running" | "completed" | "failed" };
const importSessions = new Map<string, ImportSession>();

function insertRows(session: ImportSession, rows: ImportRow[], startRow: number) {
  const insertCandidate = db.prepare("INSERT INTO candidates (id,job_id,source_id,source_object_type,source_object_id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertObservation = db.prepare("INSERT OR IGNORE INTO field_observations (id,candidate_id,source_id,field_name,field_value,source_url,observed_at,source_timestamp,verification_status,confidence) VALUES (?,?,?,?,?,?,?,?,?,NULL)");
  const run = db.transaction(() => {
    rows.forEach((row, offset) => {
      const rowNumber = startRow + offset;
      const name = (row.name || row.business_name || "").trim();
      if (!name) { session.skipped++; return; }
      const category = (row.category || row.business_category || "").trim() || "unknown";
      const address = (row.address || "").trim();
      const phone = (row.phone || row.phone_number || "").trim();
      const websiteRaw = (row.website || row.website_url || "").trim();
      const website = normalizeWebsite(websiteRaw);
      const email = (row.email || row.public_email || "").trim();
      if (websiteRaw && !website) session.invalidWebsite++;
      const sourceUrl = normalizeSourceUrl(row.source_url || "", "csv-import://" + encodeURIComponent(session.filename) + "#row=" + rowNumber);
      const candidateId = randomUUID();
      const observedAt = new Date().toISOString();
      const values: Record<string, string | null> = { name, category: (row.category || row.business_category || "").trim() || null, address: address || null, phone: phone || null, website, email: email || null };
      insertCandidate.run(candidateId, session.jobId, IMPORT_SOURCE, "csv_row", session.batchId + ":" + rowNumber, name, category, address || null, phone || null, website, email || null, sourceUrl, observedAt, JSON.stringify({ filename: session.filename, rowNumber, values: row }));
      for (const [field, value] of Object.entries(values)) if (value) insertObservation.run(randomUUID(), candidateId, IMPORT_SOURCE, field, value, sourceUrl, observedAt, null, "unverified");
      session.imported++;
    });
  });
  run();
  session.nextRow = startRow + rows.length;
}

app.get("/api/health", async () => ({ ok: true, app: "RumiReach", version: "0.3.0" }));

app.get("/api/candidates", async (request) => {
  const q = request.query as { page?: string; pageSize?: string; search?: string; category?: string; status?: string; sort?: string };
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
  if (status) { where.push("review_status = ?"); params.push(status); }
  const clause = where.join(" AND ");
  const total = (db.prepare("SELECT COUNT(*) AS count FROM candidates WHERE " + clause).get(...params) as { count: number }).count;
  const order = q.sort === "name" ? "name COLLATE NOCASE ASC" : q.sort === "category" ? "category COLLATE NOCASE ASC" : "observed_at DESC";
  const items = db.prepare("SELECT id,job_id,source_object_type,source_object_id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at,review_status FROM candidates WHERE " + clause + " ORDER BY " + order + " LIMIT ? OFFSET ?").all(...params, pageSize, (page - 1) * pageSize);
  const categories = db.prepare("SELECT DISTINCT category FROM candidates WHERE source_id = ? AND category IS NOT NULL ORDER BY category COLLATE NOCASE").all(IMPORT_SOURCE) as Array<{ category: string }>;
  const stats = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN review_status='accepted' THEN 1 ELSE 0 END) AS accepted, SUM(CASE WHEN review_status='pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN phone_raw IS NOT NULL AND phone_raw != '' THEN 1 ELSE 0 END) AS withPhone, SUM(CASE WHEN website_url IS NOT NULL AND website_url != '' THEN 1 ELSE 0 END) AS withWebsite FROM candidates WHERE source_id = ?").get(IMPORT_SOURCE);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize), categories: categories.map(x => x.category), stats };
});

app.get("/api/candidates/export", async (request, reply) => {
  const q = request.query as { search?: string; category?: string; status?: string; sort?: string };
  const search = (q.search || "").trim().slice(0, 200);
  const category = (q.category || "").trim().slice(0, 100);
  const status = ["pending", "accepted", "rejected", "needs_review"].includes(q.status || "") ? q.status! : "";
  const where = ["source_id = ?"];
  const params: string[] = [IMPORT_SOURCE];
  if (search) {
    where.push("(name LIKE ? OR category LIKE ? OR address LIKE ? OR phone_raw LIKE ? OR website_url LIKE ? OR public_email LIKE ?)");
    const term = "%" + search + "%";
    params.push(term, term, term, term, term, term);
  }
  if (category) { where.push("category = ?"); params.push(category); }
  if (status) { where.push("review_status = ?"); params.push(status); }
  const order = q.sort === "name" ? "name COLLATE NOCASE ASC" : q.sort === "category" ? "category COLLATE NOCASE ASC" : "observed_at DESC";
  const statement = db.prepare("SELECT name,category,address,phone_raw,website_url,public_email,source_url,review_status FROM candidates WHERE " + where.join(" AND ") + " ORDER BY " + order);
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\\r\\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  function* csvLines() {
    yield "\\uFEFFname,category,address,phone,website,email,source_url,review_status\\r\\n";
    for (const row of statement.iterate(...params) as Iterable<Record<string, unknown>>) {
      yield [row.name,row.category,row.address,row.phone_raw,row.website_url,row.public_email,row.source_url,row.review_status].map(cell).join(",") + "\\r\\n";
    }
  }
  return reply.type("text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="rumireach-leads.csv"').send(Readable.from(csvLines()));
});

app.post("/api/import/csv/start", async (request, reply) => {
  const body = request.body as { filename?: string };
  const filename = (body?.filename || "business-import.csv").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "business-import.csv";
  const batchId = randomUUID(), jobId = randomUUID(), createdAt = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO sources (id,name,terms_url,attribution,enabled,reviewed_at) VALUES (?,?,?,?,?,?)").run(IMPORT_SOURCE, "User-provided CSV", "Operator-supplied dataset; review original source terms before reuse.", "Preserve source attribution and only import data you are authorized to use.", 1, createdAt);
  db.prepare("INSERT INTO search_jobs (id,category,city,locality,bbox_south,bbox_west,bbox_north,bbox_east,source_id,status,candidate_count,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(jobId, "mixed", "CSV import", filename, 0, 0, 0, 0, IMPORT_SOURCE, "running", 0, createdAt, null);
  const session: ImportSession = { batchId, jobId, filename, nextRow: 2, imported: 0, skipped: 0, invalidWebsite: 0, status: "running" };
  importSessions.set(batchId, session);
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
