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
const WAHA_BASE_URL = (process.env.WAHA_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const WAHA_SESSION = process.env.WAHA_SESSION || "default";
const WAHA_API_KEY = process.env.WAHA_API_KEY || "";
function normalizeWhatsAppNumber(value: string) { let digits = value.replace(/\D/g, ""); if (digits.startsWith("00")) digits = digits.slice(2); if (digits.startsWith("0")) digits = "92" + digits.slice(1); else if (digits.length === 10 && digits.startsWith("3")) digits = "92" + digits; return digits.length >= 8 && digits.length <= 15 ? digits : ""; }
function isLocalWahaUrl() { try { const url = new URL(WAHA_BASE_URL); return ["127.0.0.1","localhost","[::1]"].includes(url.hostname) && ["http:","https:"].includes(url.protocol); } catch { return false; } }

type ImportRow = Record<string, string>;
type ImportSession = { batchId: string; jobId: string; filename: string; nextRow: number; imported: number; skipped: number; invalidWebsite: number; status: "running" | "completed" | "failed" };
const importSessions = new Map<string, ImportSession>();

function insertRows(session: ImportSession, rows: ImportRow[], startRow: number) {
  const insertCandidate = db.prepare("INSERT INTO candidates (id,job_id,source_id,source_object_type,source_object_id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertObservation = db.prepare("INSERT OR IGNORE INTO field_observations (id,candidate_id,source_id,field_name,field_value,source_url,observed_at,source_timestamp,verification_status,confidence) VALUES (?,?,?,?,?,?,?,?,?,NULL)");
  const run = db.transaction(() => {
    rows.forEach((row, offset) => {
      const rowNumber = startRow + offset;
      const name = (row.name || row.business_name || row.title || row.restaurant_name || row.business || "").trim();
      if (!name) { session.skipped++; return; }
      const category = (row.category || row.business_category || "").trim() || "unknown";
      const address = (row.address || row.full_address || row.complete_address || "").trim();
      const phone = (row.phone || row.phone_number || row.phone_raw || "").trim();
      const websiteRaw = (row.website || row.website_url || "").trim();
      const website = normalizeWebsite(websiteRaw);
      const email = (row.email || row.public_email || "").trim();
      if (websiteRaw && !website) session.invalidWebsite++;
      const sourceUrl = normalizeSourceUrl(row.source_url || row.link || row.maps_url || row.url || "", "csv-import://" + encodeURIComponent(session.filename) + "#row=" + rowNumber);
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
  const items = db.prepare("SELECT c.id,c.job_id,c.source_object_type,c.source_object_id,c.name,c.category,c.address,c.phone_raw,c.website_url,c.public_email,c.source_url,c.observed_at,c.review_status,COALESCE(w.status, 'not_confirmed') AS whatsapp_consent_status,w.consent_at AS whatsapp_consent_at FROM candidates c LEFT JOIN whatsapp_consents w ON w.candidate_id=c.id WHERE " + clause + " ORDER BY " + order + " LIMIT ? OFFSET ?").all(...params, pageSize, (page - 1) * pageSize);
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
