import { db } from "./db";

export type CityBoundary = {
  id: string;
  label: string;
  osmType: string;
  osmId: number;
  bbox: { south: number; west: number; north: number; east: number };
  area: number;
  category: string;
};

type NominatimResult = {
  place_id: number;
  osm_type: string;
  osm_id: number;
  display_name: string;
  class?: string;
  type?: string;
  addresstype?: string;
  boundingbox?: string[];
  address?: Record<string,string>;
};

const ENDPOINT = process.env.RUMIREACH_NOMINATIM_ENDPOINT || "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "RumiReach/0.2 (+https://github.com/rumitech-solutions/RumiReach)";
let requestActive = false;
let lastRequestAt = 0;

export function parseCityResults(rows: NominatimResult[]): CityBoundary[] {
  return rows.flatMap((row) => {
    if (!row.boundingbox || row.boundingbox.length !== 4) return [];
    const [south,north,west,east] = row.boundingbox.map(Number);
    if (![south,north,west,east].every(Number.isFinite) || south >= north || west >= east) return [];
    const area = (north-south)*(east-west);
    if (area <= 0 || area > 25) return [];
    return [{
      id: row.osm_type + "/" + row.osm_id,
      label: row.display_name,
      osmType: row.osm_type,
      osmId: row.osm_id,
      bbox: {south,west,north,east},
      area,
      category: row.addresstype || row.type || row.class || "place"
    }];
  });
}

export async function lookupPakistanCity(city: string): Promise<CityBoundary[]> {
  const normalized = city.trim().replace(/\\s+/g," ").toLocaleLowerCase("en");
  if (normalized.length < 2 || normalized.length > 80) throw new Error("Enter a city name between 2 and 80 characters.");
  const key = "pk:" + normalized;
  const cached = db.prepare("SELECT result_json FROM geocode_cache WHERE query_key=?").get(key) as {result_json:string}|undefined;
  if (cached) return JSON.parse(cached.result_json) as CityBoundary[];
  if (requestActive) throw new Error("City lookup is busy. Wait a moment and try again.");
  requestActive = true;
  try {
    const wait = Math.max(0,1100-(Date.now()-lastRequestAt));
    if (wait) await new Promise(resolve=>setTimeout(resolve,wait));
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({q: city.trim()+", Pakistan",format:"jsonv2",countrycodes:"pk",addressdetails:"1",limit:"5"}).toString();
    lastRequestAt = Date.now();
    const response = await fetch(url,{headers:{"user-agent":USER_AGENT,"accept-language":"en"},signal:AbortSignal.timeout(12000)});
    if (response.status === 429 || response.status === 503) throw new Error("The public geocoder is busy or rate-limiting. Wait before trying again.");
    if (!response.ok) throw new Error("City geocoder returned HTTP "+response.status+".");
    const rows = await response.json() as NominatimResult[];
    const results = parseCityResults(rows);
    if (!results.length) throw new Error("No Pakistan city boundary match was found. Check the spelling or use a smaller locality.");
    db.prepare("INSERT OR REPLACE INTO geocode_cache (query_key,result_json,cached_at) VALUES (?,?,?)").run(key,JSON.stringify(results),new Date().toISOString());
    return results;
  } finally {
    requestActive = false;
  }
}
