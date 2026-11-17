import { randomUUID } from "node:crypto";
import { db } from "./db";

type Bbox = { south: number; west: number; north: number; east: number };
type OsmElement = { type: "node" | "way" | "relation"; id: number; tags?: Record<string,string> };
const ENDPOINT = process.env.RUMIREACH_OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter";
const USER_AGENT = "RumiReach/0.2 (+https://github.com/rumitech-solutions/RumiReach)";
let activeRequest = false;

// Each category maps to OSM's documented tagging conventions. "all" is deliberately
// bounded to common business-related tags; it is not a promise of complete coverage.
const CATEGORY_FILTERS: Record<string, string[]> = {
  all: ['[name][shop]', '[name][amenity]', '[name][office]', '[name][tourism]', '[name][craft]', '[name][healthcare]', '[name][leisure~"fitness_centre|sports_centre"]'],
  restaurant: ['[amenity=restaurant]'],
  cafe: ['[amenity=cafe]'],
  shop: ['[shop]'],
  supermarket: ['[shop=supermarket]'],
  clothing: ['[shop=clothes]'],
  electronics: ['[shop=electronics]'],
  grocery: ['[shop=convenience]', '[shop=greengrocer]'],
  clinic: ['[amenity=clinic]', '[healthcare=clinic]'],
  hospital: ['[amenity=hospital]', '[healthcare=hospital]'],
  pharmacy: ['[amenity=pharmacy]', '[healthcare=pharmacy]'],
  dentist: ['[amenity=dentist]', '[healthcare=dentist]'],
  school: ['[amenity=school]'],
  college: ['[amenity=college]'],
  university: ['[amenity=university]'],
  hotel: ['[tourism=hotel]'],
  guest_house: ['[tourism=guest_house]'],
  salon: ['[shop=hairdresser]'],
  beauty: ['[shop=beauty]'],
  gym: ['[leisure=fitness_centre]', '[leisure=sports_centre]'],
  bank: ['[amenity=bank]'],
  real_estate: ['[office=estate_agent]'],
  car_repair: ['[shop=car_repair]', '[craft=car_repair]'],
  lawyer: ['[office=lawyer]'],
  accountant: ['[office=accountant]'],
  office: ['[office]'],
  tourism: ['[tourism]'],
  fuel: ['[amenity=fuel]']
};

export function buildOverpassQuery(category: string, b: Bbox): string {
  const filters = CATEGORY_FILTERS[category];
  if (!filters) throw new Error("Unsupported business category: " + category);
  const box = [b.south,b.west,b.north,b.east].join(",");
  const clauses = filters.map(filter => `nwr${filter}(${box});`).join("");
  return `[out:json][timeout:30];(${clauses});out tags center;`;
}
function addressFrom(tags: Record<string,string>): string | null {
  if (tags["addr:full"]) return tags["addr:full"];
  const parts = [tags["addr:housenumber"],tags["addr:street"],tags["addr:suburb"],tags["addr:city"],tags["addr:postcode"]].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
function safeWebsite(value?: string): string | null {
  if (!value) return null;
  try {
    const candidate = new URL((value.startsWith("http://") || value.startsWith("https://")) ? value : "https://" + value);
    return candidate.protocol === "http:" || candidate.protocol === "https:" ? candidate.toString() : null;
  } catch { return null; }
}
export async function discoverBusinesses(input: {jobId:string;bbox:Bbox;maxResults:number;category:string}): Promise<{count:number;sourceTimestamp:string|null}> {
  if (activeRequest) throw new Error("Another Overpass request is running. Wait for it to finish.");
  activeRequest = true;
  try {
    const response = await fetch(ENDPOINT, {
      method:"POST",
      headers:{"content-type":"application/x-www-form-urlencoded","user-agent":USER_AGENT},
      body:new URLSearchParams({data:buildOverpassQuery(input.category,input.bbox)}),
      signal:AbortSignal.timeout(35000)
    });
    if (response.status === 429 || response.status === 503) throw new Error("Overpass is busy/rate-limiting (HTTP " + response.status + "). Pause this source and retry later; do not treat this as zero results.");
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
          category: [tags.amenity,tags.shop,tags.office,tags.tourism,tags.healthcare,tags.leisure,tags.craft,tags.cuisine].filter(Boolean).join(" · ") || input.category,
          address: addressFrom(tags),
          phone: tags.phone || tags["contact:phone"] || tags.mobile || null,
          website: safeWebsite(tags.website || tags["contact:website"] || undefined),
          email: tags.email || tags["contact:email"] || null
        };
        const result = insert.run(candidateId,input.jobId,"osm_overpass",item.type,String(item.id),
          values.name,values.category,values.address,values.phone,values.website,values.email,
          sourceUrl,observedAt,JSON.stringify(item));
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
