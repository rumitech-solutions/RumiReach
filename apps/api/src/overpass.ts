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
    const insert = db.prepare("INSERT OR IGNORE INTO candidates (id,job_id,source_id,source_object_type,source_object_id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const save = db.transaction((elements:OsmElement[]) => {
      let count = 0;
      for (const item of elements) {
        const tags = item.tags || {};
        const result = insert.run(
          randomUUID(),input.jobId,"osm_overpass",item.type,String(item.id),
          tags.name || null,[tags.amenity,tags.cuisine].filter(Boolean).join(" · ") || "restaurant",
          addressFrom(tags),tags.phone || tags["contact:phone"] || tags.mobile || null,
          safeWebsite(tags.website || tags["contact:website"] || undefined),tags.email || tags["contact:email"] || null,
          "https://www.openstreetmap.org/" + item.type + "/" + item.id,observedAt,JSON.stringify(item)
        );
        count += Number(result.changes);
      }
      return count;
    });
    return {count:save(items),sourceTimestamp:payload.osm3s?.timestamp_osm_base || null};
  } finally { activeRequest = false; }
}
