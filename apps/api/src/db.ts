import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const dataDir = process.env.RUMIREACH_DATA_DIR || join(process.env.LOCALAPPDATA || homedir(), "RumiReach", "data");
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
"CREATE INDEX IF NOT EXISTS idx_candidates_review ON candidates(review_status);"
"CREATE TABLE IF NOT EXISTS field_observations (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, source_id TEXT NOT NULL REFERENCES sources(id), field_name TEXT NOT NULL, field_value TEXT NOT NULL, source_url TEXT NOT NULL, observed_at TEXT NOT NULL, source_timestamp TEXT, verification_status TEXT NOT NULL DEFAULT 'unverified', confidence REAL, UNIQUE(candidate_id, source_id, field_name, field_value));",
"CREATE INDEX IF NOT EXISTS idx_field_observations_candidate ON field_observations(candidate_id, field_name);",
"CREATE INDEX IF NOT EXISTS idx_field_observations_source ON field_observations(source_id, observed_at);"
].join("\n"));

db.prepare("INSERT OR IGNORE INTO sources (id,name,terms_url,attribution,enabled,reviewed_at) VALUES (?,?,?,?,?,?)").run(
  "osm_overpass", "OpenStreetMap via Overpass", "https://www.openstreetmap.org/copyright",
  "© OpenStreetMap contributors — data available under the Open Database License (ODbL)", 1, "2026-11-17"
);
