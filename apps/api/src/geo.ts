import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./db";

/**
 * Country → state → city lookup used by the "Find leads" panel.
 *
 * The dataset (dr5hn/countries-states-cities-database, ODbL) is NOT bundled with the repository.
 * It is downloaded once on first use, split into one small JSON file per country and cached under
 * the local RumiReach data directory so the pickers work offline afterwards.
 */
const SOURCE_URL = process.env.RUMIREACH_GEO_URL
  || "https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/json/countries%2Bstates%2Bcities.json";
const geoDir = join(dataDir, "geo");
const indexFile = join(geoDir, "countries.json");

export type GeoCountry = { code: string; name: string; stateCount: number };
export type GeoState = { id: string; name: string; cityCount: number };
type StoredState = { id: string; name: string; cities: string[] };
type StoredCountry = { code: string; name: string; states: StoredState[] };

let building: Promise<void> | null = null;
let lastError = "";

export function geoStatus() {
  return { ready: existsSync(indexFile), downloading: building !== null, error: lastError };
}

export function isCountryCode(value: string) { return /^[A-Z]{2}$/.test(value); }

async function buildCache() {
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!response.ok) throw new Error("Location dataset download failed (HTTP " + response.status + ").");
  const data = JSON.parse(await response.text()) as Array<{ iso2: string; name: string; states?: Array<{ id: number | string; name: string; cities?: Array<{ name: string }> }> }>;
  await mkdir(geoDir, { recursive: true });
  const index: GeoCountry[] = [];
  for (const country of data) {
    if (!isCountryCode(country.iso2 || "")) continue;
    const states: StoredState[] = (country.states || [])
      .map(state => ({
        id: String(state.id),
        name: state.name,
        cities: [...new Set((state.cities || []).map(city => city.name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    index.push({ code: country.iso2, name: country.name, stateCount: states.length });
    const stored: StoredCountry = { code: country.iso2, name: country.name, states };
    await writeFile(join(geoDir, country.iso2 + ".json"), JSON.stringify(stored));
  }
  index.sort((a, b) => a.name.localeCompare(b.name));
  // Write the index last (via rename) so a half-finished download is never treated as ready.
  const tmp = indexFile + ".tmp";
  await writeFile(tmp, JSON.stringify(index));
  await rename(tmp, indexFile);
}

export async function ensureGeoData() {
  if (existsSync(indexFile)) return;
  if (!building) {
    lastError = "";
    building = buildCache()
      .catch(error => { lastError = error instanceof Error ? error.message : "Location dataset download failed."; throw error; })
      .finally(() => { building = null; });
  }
  await building;
}

export async function listCountries(): Promise<GeoCountry[]> {
  await ensureGeoData();
  return JSON.parse(await readFile(indexFile, "utf8")) as GeoCountry[];
}

export async function getCountry(code: string): Promise<StoredCountry | null> {
  if (!isCountryCode(code)) return null;
  await ensureGeoData();
  const file = join(geoDir, code + ".json");
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8")) as StoredCountry;
}

export async function listStates(code: string): Promise<GeoState[] | null> {
  const country = await getCountry(code);
  return country ? country.states.map(state => ({ id: state.id, name: state.name, cityCount: state.cities.length })) : null;
}

export async function listCities(code: string, stateId: string): Promise<string[] | null> {
  const country = await getCountry(code);
  return country?.states.find(state => state.id === stateId)?.cities ?? null;
}
