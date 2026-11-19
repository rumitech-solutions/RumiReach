import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const dataDir = process.env.RUMIREACH_DATA_DIR || join(process.env.LOCALAPPDATA || homedir(), "RumiReach", "data");
const dbPath = join(dataDir, "rumireach.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec([
"CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, terms_url TEXT NOT NULL, attribution TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, reviewed_at TEXT NOT NULL);",
"CREATE TABLE IF NOT EXISTS search_jobs (id TEXT PRIMARY KEY, category TEXT NOT NULL, city TEXT NOT NULL, locality TEXT NOT NULL, bbox_south REAL NOT NULL, bbox_west REAL NOT NULL, bbox_north REAL NOT NULL, bbox_east REAL NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id), status TEXT NOT NULL, candidate_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, source_timestamp TEXT, created_at TEXT NOT NULL, finished_at TEXT);",
"CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES search_jobs(id) ON DELETE CASCADE, source_id TEXT NOT NULL REFERENCES sources(id), source_object_type TEXT NOT NULL, source_object_id TEXT NOT NULL, name TEXT, category TEXT, address TEXT, phone_raw TEXT, website_url TEXT, public_email TEXT, source_url TEXT NOT NULL, observed_at TEXT NOT NULL, raw_json TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'pending', UNIQUE(job_id, source_id, source_object_type, source_object_id));",
"CREATE INDEX IF NOT EXISTS idx_candidates_job ON candidates(job_id);",
"CREATE INDEX IF NOT EXISTS idx_candidates_review ON candidates(review_status);",
"CREATE INDEX IF NOT EXISTS idx_candidates_source_observed ON candidates(source_id, observed_at DESC);",
"CREATE INDEX IF NOT EXISTS idx_candidates_source_category ON candidates(source_id, category);",
"CREATE INDEX IF NOT EXISTS idx_candidates_source_status ON candidates(source_id, review_status);",
"CREATE TABLE IF NOT EXISTS field_observations (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, source_id TEXT NOT NULL REFERENCES sources(id), field_name TEXT NOT NULL, field_value TEXT NOT NULL, source_url TEXT NOT NULL, observed_at TEXT NOT NULL, source_timestamp TEXT, verification_status TEXT NOT NULL DEFAULT 'unverified', confidence REAL, UNIQUE(candidate_id, source_id, field_name, field_value));",
"CREATE INDEX IF NOT EXISTS idx_field_observations_candidate ON field_observations(candidate_id, field_name);",
"CREATE INDEX IF NOT EXISTS idx_field_observations_source ON field_observations(source_id, observed_at);"
].join("\n"));

db.prepare("INSERT OR IGNORE INTO sources (id,name,terms_url,attribution,enabled,reviewed_at) VALUES (?,?,?,?,?,?)").run(
  "osm_overpass", "OpenStreetMap via Overpass", "https://www.openstreetmap.org/copyright",
  "© OpenStreetMap contributors — data available under the Open Database License (ODbL)", 1, "2026-11-17"
);

db.exec("CREATE TABLE IF NOT EXISTS whatsapp_consents (candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE, phone_e164 TEXT NOT NULL, status TEXT NOT NULL, consent_method TEXT, consent_evidence TEXT, consent_at TEXT NOT NULL, updated_at TEXT NOT NULL);");
db.exec("CREATE INDEX IF NOT EXISTS idx_whatsapp_consents_status ON whatsapp_consents(status, updated_at);");
db.exec("CREATE TABLE IF NOT EXISTS whatsapp_send_log (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, phone_e164 TEXT NOT NULL, provider_message_id TEXT, status TEXT NOT NULL, error_message TEXT, sent_at TEXT NOT NULL);");
db.exec("CREATE INDEX IF NOT EXISTS idx_whatsapp_send_log_sent_at ON whatsapp_send_log(sent_at);");
db.exec("CREATE TABLE IF NOT EXISTS geocode_cache (query_key TEXT PRIMARY KEY, result_json TEXT NOT NULL, cached_at TEXT NOT NULL);");

db.exec("CREATE TABLE IF NOT EXISTS discovery_tiles (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES search_jobs(id) ON DELETE CASCADE, tile_index INTEGER NOT NULL, bbox_south REAL NOT NULL, bbox_west REAL NOT NULL, bbox_north REAL NOT NULL, bbox_east REAL NOT NULL, status TEXT NOT NULL DEFAULT 'queued', candidate_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, started_at TEXT, finished_at TEXT, UNIQUE(job_id,tile_index));");
db.exec("CREATE INDEX IF NOT EXISTS idx_discovery_tiles_job_status ON discovery_tiles(job_id,status,tile_index);");

try { db.exec("ALTER TABLE search_jobs ADD COLUMN max_results INTEGER NOT NULL DEFAULT 100"); } catch { /* already migrated */ }

db.prepare("UPDATE discovery_tiles SET status='queued',error_message=NULL,started_at=NULL,finished_at=NULL WHERE status='running'").run();
db.prepare("UPDATE search_jobs SET status='failed',error_message='API restarted while this job was running. Resume to continue queued tiles.',finished_at=? WHERE status='running'").run(new Date().toISOString());

db.exec("CREATE INDEX IF NOT EXISTS idx_candidates_source_url ON candidates(source_id, source_url);");
db.exec("CREATE TABLE IF NOT EXISTS scrape_runs (id TEXT PRIMARY KEY, keywords TEXT NOT NULL, country TEXT NOT NULL, state TEXT, city TEXT, query_count INTEGER NOT NULL, runner TEXT NOT NULL, status TEXT NOT NULL, imported INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0, error_message TEXT, import_job_id TEXT, created_at TEXT NOT NULL, finished_at TEXT);");
db.prepare("UPDATE scrape_runs SET status='failed',error_message='API restarted while this scrape was running.',finished_at=? WHERE status IN ('running','importing')").run(new Date().toISOString());
