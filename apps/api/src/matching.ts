import { randomUUID } from "node:crypto";
import { db } from "./db";

type Candidate = {
  id: string; name: string | null; category: string | null; address: string | null;
  phone_raw: string | null; website_url: string | null; public_email: string | null;
};

export function normalizePakistaniPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/(?:ext\.?|extension|x)\s*\d+$/i, "").replace(/\D/g, "");
  if (digits.startsWith("0092")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("92") && digits.length >= 12) digits = "0" + digits.slice(2);
  else if (digits.startsWith("3") && digits.length === 10) digits = "0" + digits;
  return digits.length >= 10 && digits.length <= 12 ? digits : null;
}

export function normalizeWebsiteDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!host || !host.includes(".") || /(^|\.)(facebook|instagram|linkedin|youtube|tiktok|twitter|x)\.com$/i.test(host)) return null;
    return host;
  } catch { return null; }
}

export function normalizeBusinessName(value: string | null | undefined): string {
  return (value || "").normalize("NFKC").toLocaleLowerCase("en")
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(private limited|pvt ltd|pvt|limited|ltd|llc|company|co)\b/g, " ")
    .trim().replace(/\s+/g, " ");
}

export function nameSimilarity(a: string | null, b: string | null): number {
  const left = normalizeBusinessName(a), right = normalizeBusinessName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const aTokens = new Set(left.split(" ")), bTokens = new Set(right.split(" "));
  const intersection = [...aTokens].filter(token => bTokens.has(token)).length;
  return intersection / new Set([...aTokens, ...bTokens]).size;
}

function normalizeAddress(value: string | null): string {
  return (value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function addressesCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const left = normalizeAddress(a), right = normalizeAddress(b);
  if (left === right) return true;
  const l = new Set(left.split(" ")), r = new Set(right.split(" "));
  const overlap = [...l].filter(x => r.has(x)).length / new Set([...l, ...r]).size;
  return overlap >= 0.65;
}
function branchConflict(a: Candidate, b: Candidate): boolean {
  const branchPattern = /\b(branch|outlet|campus|phase|sector|mall|plaza|airport|dha|gulberg|f\s*\d+)\b/i;
  const an = normalizeBusinessName(a.name), bn = normalizeBusinessName(b.name);
  if (branchPattern.test(an) && branchPattern.test(bn) && an !== bn && !an.includes(bn) && !bn.includes(an)) return true;
  return !addressesCompatible(a.address, b.address);
}

export type MatchDecision = { matched: boolean; confidence: number; reasons: string[] };
export function compareBusinessRecords(a: Candidate, b: Candidate): MatchDecision {
  const reasons: string[] = [];
  const phoneA = normalizePakistaniPhone(a.phone_raw), phoneB = normalizePakistaniPhone(b.phone_raw);
  const domainA = normalizeWebsiteDomain(a.website_url), domainB = normalizeWebsiteDomain(b.website_url);
  const similarity = nameSimilarity(a.name, b.name);
  if (phoneA && phoneA === phoneB) reasons.push("exact_normalized_phone");
  if (domainA && domainA === domainB) reasons.push("exact_website_domain");
  if (similarity >= 0.8) reasons.push("strong_name_similarity");
  else if (similarity >= 0.6) reasons.push("supporting_name_similarity");
  if (branchConflict(a, b)) return { matched: false, confidence: Math.min(0.49, similarity * 0.49), reasons: [...reasons, "address_or_branch_conflict"] };

  const phoneMatch = phoneA !== null && phoneA === phoneB && similarity >= 0.6;
  const domainMatch = domainA !== null && domainA === domainB && similarity >= 0.8;
  if (phoneMatch) return { matched: true, confidence: similarity >= 0.8 ? 0.99 : 0.94, reasons };
  if (domainMatch) return { matched: true, confidence: 0.92, reasons };
  return { matched: false, confidence: Math.min(0.89, similarity * 0.7), reasons };
}

export function resolveUnlinkedCandidates(): { processed: number; autoMerged: number; newProfiles: number } {
  const pending = db.prepare(`
    SELECT c.id,c.name,c.category,c.address,c.phone_raw,c.website_url,c.public_email
    FROM candidates c LEFT JOIN business_profile_sources bps ON bps.candidate_id=c.id
    WHERE bps.candidate_id IS NULL ORDER BY c.observed_at,c.id
  `).all() as Candidate[];
  let autoMerged = 0, newProfiles = 0;
  const attach = db.prepare("INSERT INTO business_profile_sources (profile_id,candidate_id,match_confidence,match_reasons,linked_at) VALUES (?,?,?,?,?)");
  const createProfile = db.prepare("INSERT INTO business_profiles (id,canonical_name,category,address,phone_raw,website_url,public_email,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
  const history = db.prepare("INSERT INTO merge_history (id,profile_id,candidate_id,confidence,reasons_json,merged_at) VALUES (?,?,?,?,?,?)");
  const existing = db.prepare(`
    SELECT c.id,c.name,c.category,c.address,c.phone_raw,c.website_url,c.public_email
    FROM business_profile_sources bps JOIN candidates c ON c.id=bps.candidate_id
    WHERE bps.profile_id=?
  `);
  const run = db.transaction(() => {
    for (const candidate of pending) {
      const profiles = db.prepare("SELECT id FROM business_profiles ORDER BY created_at").all() as Array<{id:string}>;
      let best: {profileId:string; confidence:number; reasons:string[]}|null = null;
      for (const profile of profiles) {
        const members = existing.all(profile.id) as Candidate[];
        for (const member of members) {
          const decision = compareBusinessRecords(candidate, member);
          if (decision.matched && (!best || decision.confidence > best.confidence)) best = {profileId:profile.id,confidence:decision.confidence,reasons:decision.reasons};
        }
      }
      const now = new Date().toISOString();
      if (best) {
        attach.run(best.profileId,candidate.id,best.confidence,JSON.stringify(best.reasons),now);
        history.run(randomUUID(),best.profileId,candidate.id,best.confidence,JSON.stringify(best.reasons),now);
        db.prepare(`UPDATE business_profiles SET
          canonical_name=COALESCE(canonical_name,?),category=COALESCE(category,?),address=COALESCE(address,?),
          phone_raw=COALESCE(phone_raw,?),website_url=COALESCE(website_url,?),public_email=COALESCE(public_email,?),updated_at=?
          WHERE id=?`).run(candidate.name,candidate.category,candidate.address,candidate.phone_raw,candidate.website_url,candidate.public_email,now,best.profileId);
        autoMerged++;
      } else {
        const profileId = randomUUID();
        createProfile.run(profileId,candidate.name,candidate.category,candidate.address,candidate.phone_raw,candidate.website_url,candidate.public_email,now,now);
        attach.run(profileId,candidate.id,1,JSON.stringify(["first_source_record"]),now);
        newProfiles++;
      }
    }
  });
  run();
  return { processed: pending.length, autoMerged, newProfiles };
}

export function ensureMatchingSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS business_profiles (
      id TEXT PRIMARY KEY, canonical_name TEXT, category TEXT, address TEXT, phone_raw TEXT,
      website_url TEXT, public_email TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS business_profile_sources (
      profile_id TEXT NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
      match_confidence REAL NOT NULL, match_reasons TEXT NOT NULL, linked_at TEXT NOT NULL,
      PRIMARY KEY(profile_id,candidate_id)
    );
    CREATE INDEX IF NOT EXISTS idx_business_profile_sources_profile ON business_profile_sources(profile_id);
    CREATE TABLE IF NOT EXISTS merge_history (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES business_profiles(id),
      candidate_id TEXT NOT NULL REFERENCES candidates(id), confidence REAL NOT NULL,
      reasons_json TEXT NOT NULL, merged_at TEXT NOT NULL
    );
  `);
  resolveUnlinkedCandidates();
}
