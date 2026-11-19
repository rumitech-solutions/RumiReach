import { randomUUID } from "node:crypto";
import { db } from "./db";
import { normalizeSourceUrl, normalizeWebsite } from "./csv";

export const IMPORT_SOURCE = "user_csv_import";

export type ImportRow = Record<string, string>;
export type ImportSession = { batchId: string; jobId: string; filename: string; nextRow: number; imported: number; skipped: number; invalidWebsite: number; status: "running" | "completed" | "failed" };
export const importSessions = new Map<string, ImportSession>();

export function insertRows(session: ImportSession, rows: ImportRow[], startRow: number) {
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


export function createImportSession(filename: string, meta: { name?: string; category?: string; city?: string } = {}): ImportSession {
  const batchId = randomUUID(), jobId = randomUUID(), createdAt = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO sources (id,name,terms_url,attribution,enabled,reviewed_at) VALUES (?,?,?,?,?,?)").run(IMPORT_SOURCE, "User-provided CSV", "Operator-supplied dataset; review original source terms before reuse.", "Preserve source attribution and only import data you are authorized to use.", 1, createdAt);
  db.prepare("INSERT INTO search_jobs (id,category,city,locality,bbox_south,bbox_west,bbox_north,bbox_east,source_id,status,candidate_count,created_at,finished_at,name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(jobId, meta.category || "mixed", meta.city || "CSV import", filename, 0, 0, 0, 0, IMPORT_SOURCE, "running", 0, createdAt, null, meta.name || filename.replace(/\.csv$/i, ""));
  const session: ImportSession = { batchId, jobId, filename, nextRow: 2, imported: 0, skipped: 0, invalidWebsite: 0, status: "running" };
  importSessions.set(batchId, session);
  return session;
}
