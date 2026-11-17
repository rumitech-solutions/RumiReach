import { randomUUID } from "node:crypto";
import { db } from "./db";

type Bbox = { south: number; west: number; north: number; east: number };
type OsmElement = { type: "node" | "way" | "relation"; id: number; tags?: Record<string,string> };
const ENDPOINT = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "RumiReach/0.1 (+https://github.com/rumitech-solutions/RumiReach)";
let activeRequest = false;

function addressFrom(tags: Record<string,string>): string | null {
  if (tags["addr:full"]) return tags["addr:full"];
  const parts = [tags["addr:housenumber"],tags["addr:street"],tags["addr:suburb"],tags["addr:city"],tags["addr:postcode"]].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
function safeWebsite(value?: string): string | null {
  if (!value) return null;
  try {
    const candidate = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value);
    return candidate.protocol === "http:" || candidate.protocol === "https:" ? candidate.toString() : null;
  } catch { return null; }
}
function makeQuery(b: Bbox): string {
  const box = [b.south,b.west,b.north,b.east].join(",");
  return '[out:json][timeout:30];(nwr["amenity"="restaurant"](' + box + '););out tags center;';
}
export async function discoverRestaurants(input: {jobId:string;bbox:Bbox;maxResults:number}): Promise<{count:number;sourceTimestamp:string|null}> {
  if (activeRequest) throw new Error("Another Overpass request is running. Wait for it to finish.");
  activeRequest = true;
  try {
    const response = await fetch(ENDPOINT, {
      method:"POST",
      headers:{"content-type":"application/x-www-form-urlencoded","user-agent":USER_AGENT},
      body:new URLSearchParams({data:makeQuery(input.bbox)}),
      signal:AbortSignal.timeout(35000)
    });
    if (response.status === 429) throw new Error("Overpass rate limit (429). Stop and wait; do not retry automatically.");
    if (!response.ok) throw new Error("Overpass returned HTTP " + response.status);
    const payload = await response.json() as {elements?:OsmElement[];osm3s?:{timestamp_osm_base?:string}};
    const items = (payload.elements || []).slice(0,input.maxResults);
    const observedAt = new Date().toISOString();
    const sourceTimestamp = payload.osm3s?.timestamp_osm_base || null;
    const insert = db.prepare("INSERT OR IGNORE INTO candidates (id,job_id,source_id,source_object_type,source_object_id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const observation = db.prepare("INSERT OR IGNORE INTO field_observations (id,candidate_id,source_id,field_name,field_value,source_url,observed_at,source_timestamp,verification_status,confidence) VALUES (?,?,?,?,?,?,?,?,?,NULL)");
    const save = db.transaction((elements:OsmElement[]) => {
      let count = 0;
      for (const item of elements) {
        const tags = item.tags || {};
        const candidateId = randomUUID();
        const sourceUrl = "https://www.openstreetmap.org/" + item.type + "/" + item.id;
        const values: Record<string,string|null> = {
          name: tags.name || null,
          category: [tags.amenity,tags.cuisine].filter(Boolean).join(" · ") || "restaurant",
          address: addressFrom(tags),
          phone: tags.phone || tags["contact:phone"] || tags.mobile || null,
          website: safeWebsite(tags.website || tags["contact:website"] || undefined),
          email: tags.email || tags["contact:email"] || null
        };
        const result = insert.run(
          candidateId,input.jobId,"osm_overpass",item.type,String(item.id),
          values.name,values.category,values.address,values.phone,values.website,values.email,
          sourceUrl,observedAt,JSON.stringify(item)
        );
        if (Number(result.changes)) {
          count += 1;
          for (const [field,value] of Object.entries(values)) {
            if (value) observation.run(randomUUID(),candidateId,"osm_overpass",field,value,sourceUrl,observedAt,sourceTimestamp,"unverified");
          }
        }
      }
      return count;
    });
    return {count:save(items),sourceTimestamp};
  } finally { activeRequest = false; }
}
