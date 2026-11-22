import { useEffect, useMemo, useRef, useState } from "react";

type Country = { code: string; name: string; stateCount: number };
type GeoState = { id: string; name: string; cityCount: number };
type Run = { id: string; name: string | null; collectionId: string | null; keywords: string; country: string; state: string | null; city: string | null; queryCount: number; runner: string; status: string; imported: number; duplicates: number; error: string | null; createdAt: string; log: string[]; elapsedSeconds: number | null };
type Status = { runner: { available: boolean; mode: string; hint: string }; maxCities: number; defaultCities: number; maxSearches?: number };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!response.ok) throw new Error((data as { error?: string } | null)?.error || "Request failed (HTTP " + response.status + ").");
  return data as T;
}

const isActive = (run: Run) => run.status === "running" || run.status === "importing";
const formatElapsed = (seconds: number) => Math.floor(seconds / 60) + "m " + String(seconds % 60).padStart(2, "0") + "s";

export default function FindLeads({ onImported, onOpenCollection }: { onImported: () => void; onOpenCollection: (id: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);
  const [states, setStates] = useState<GeoState[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [country, setCountry] = useState("");
  const [stateId, setStateId] = useState("");
  const [city, setCity] = useState("");
  const [keywords, setKeywords] = useState("");
  const [name, setName] = useState("");
  const [maxCities, setMaxCities] = useState(10);
  const [depth, setDepth] = useState(5);
  const [email, setEmail] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [geoNote, setGeoNote] = useState("Loading locations… the first load downloads the location list once (about 1 minute).");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const previouslyActive = useRef<Set<string>>(new Set());

  const keywordList = useMemo(() => [...new Set(keywords.split(/[\n,]+/).map(value => value.trim()).filter(Boolean))], [keywords]);
  const stateName = states.find(item => item.id === stateId)?.name;
  const cityCount = city ? 1 : stateId ? Math.min(maxCities, cities.length) : 0;
  const searchCount = keywordList.length * Math.max(1, cityCount);
  const maxSearches = status?.maxSearches ?? 5000;
  const active = runs.find(isActive);

  useEffect(() => {
    api<Status>("/api/scrape/status").then(value => { setStatus(value); setMaxCities(value.defaultCities); }).catch(reason => setError(reason.message));
    api<{ countries: Country[] }>("/api/geo/countries")
      .then(value => { setCountries(value.countries); setGeoNote(""); })
      .catch(reason => setGeoNote(reason.message));
  }, []);

  useEffect(() => {
    setStateId(""); setCity(""); setStates([]); setCities([]);
    if (!country) return;
    api<{ states: GeoState[] }>("/api/geo/countries/" + country + "/states").then(value => setStates(value.states)).catch(reason => setError(reason.message));
  }, [country]);

  useEffect(() => {
    setCity(""); setCities([]);
    if (!country || !stateId) return;
    api<{ cities: string[] }>("/api/geo/countries/" + country + "/states/" + stateId + "/cities").then(value => setCities(value.cities)).catch(reason => setError(reason.message));
  }, [country, stateId]);

  async function loadRuns() {
    const { runs: latest } = await api<{ runs: Run[] }>("/api/scrape/runs");
    const nowActive = new Set(latest.filter(isActive).map(run => run.id));
    // A run that was active on the previous poll and no longer is has just finished importing.
    if ([...previouslyActive.current].some(id => !nowActive.has(id))) onImported();
    previouslyActive.current = nowActive;
    setRuns(latest);
  }

  useEffect(() => {
    void loadRuns().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void loadRuns().catch(() => undefined), 2000);
    return () => clearInterval(timer);
  }, [active?.id]);

  async function start() {
    setError(""); setBusy(true);
    try {
      await api("/api/scrape/runs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ keywords: keywordList, name: name.trim() || undefined, country, state: stateId || undefined, city: city || undefined, maxCities, depth, email, authorized })
      });
      await loadRuns();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start the scrape."); }
    finally { setBusy(false); }
  }

  async function rerun(id: string) {
    setError("");
    try { await api("/api/scrape/runs/" + id + "/rerun", { method: "POST" }); await loadRuns(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not repeat the search."); }
  }

  async function cancel(id: string) {
    try { await api("/api/scrape/runs/" + id + "/cancel", { method: "POST" }); await loadRuns(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not cancel."); }
  }

  const canStart = !!status?.runner.available && !active && !busy && authorized && !!country && keywordList.length > 0 && searchCount <= maxSearches;

  return <section className="panel find-panel" id="find">
    <div className="section-heading"><div><span className="section-kicker">01 / FIND LEADS</span><h2>Find businesses automatically</h2><p>Type what you are looking for, pick a location, and RumiReach collects matching businesses from Google Maps straight into your directory.</p></div><span className="format-badge">AUTO SCRAPE</span></div>
    {status && !status.runner.available && <div className="inline-error">{status.runner.hint}</div>}
    <div className="find-grid">
      <label className="find-field find-wide"><span>What are you looking for?</span>
        <textarea value={keywords} onChange={event => setKeywords(event.target.value)} placeholder={"dentist\nrestaurant, cafe\nAdd as many as you like: one per line or separated by commas"} rows={6}/>
        <small>{keywordList.length ? keywordList.length.toLocaleString() + " search term" + (keywordList.length === 1 ? "" : "s") + " · no limit on terms, each one is searched in every chosen place." : "One search term per line or separated by commas, e.g. “dentist”, “gym”, “real estate agent”."}</small></label>
      <label className="find-field find-wide"><span>Save this search as (optional)</span>
        <input value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder="e.g. Lahore dentists – Nov"/><small>Results are saved as a named collection you can reopen, export or delete later. Left empty, a name is made from your search.</small></label>
      <label className="find-field"><span>Country</span>
        <select value={country} onChange={event => setCountry(event.target.value)} disabled={!countries.length}><option value="">{countries.length ? "Select a country" : "Loading…"}</option>{countries.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      <label className="find-field"><span>State / province</span>
        <select value={stateId} onChange={event => setStateId(event.target.value)} disabled={!states.length}><option value="">{country ? (states.length ? "Whole country (broad)" : "No states listed") : "Pick a country first"}</option>{states.map(item => <option key={item.id} value={item.id}>{item.name} ({item.cityCount} cities)</option>)}</select></label>
      <label className="find-field"><span>City</span>
        <select value={city} onChange={event => setCity(event.target.value)} disabled={!cities.length}><option value="">{stateId ? "All cities in " + (stateName || "state") + " (first " + Math.min(maxCities, cities.length) + ")" : "Pick a state first"}</option>{cities.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="find-field"><span>Cities to cover when none is chosen</span>
        <input type="number" min={1} max={status?.maxCities ?? 50} value={maxCities} disabled={!!city || !stateId} onChange={event => setMaxCities(Math.min(status?.maxCities ?? 50, Math.max(1, Number(event.target.value) || 1)))}/></label>
      <label className="find-field"><span>Results per search (scroll depth)</span>
        <input type="number" min={1} max={20} value={depth} onChange={event => setDepth(Math.min(20, Math.max(1, Number(event.target.value) || 1)))}/><small>Higher finds more businesses but takes longer.</small></label>
      <label className="find-check find-wide"><input type="checkbox" checked={email} onChange={event => setEmail(event.target.checked)}/><span><strong>Also look for email addresses</strong><small>Visits each business website; noticeably slower.</small></span></label>
      <label className="find-check find-wide"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)}/><span><strong>I am authorized to collect and use this data</strong><small>Automated collection from Google Maps may be restricted by Google’s terms and local privacy law. You are responsible for how you use the results.</small></span></label>
    </div>
    {geoNote && <div className="import-progress">{geoNote}</div>}
    {error && <div className="inline-error">{error}</div>}
    <div className="import-submit">
      <span className="selected-file">{country ? (searchCount ? searchCount + " search" + (searchCount === 1 ? "" : "es") + " will run" : "Add a search term") : "Choose a location to begin"}{searchCount > maxSearches ? " — over the limit of " + maxSearches.toLocaleString() + ", reduce terms or cities" : ""}</span>
      <button className="primary-button" disabled={!canStart} onClick={() => void start()}>{busy ? "Starting…" : "Start finding leads"} <span>→</span></button>
    </div>
    {runs.length > 0 && <div className="find-runs"><h3>Recent runs</h3>{runs.map(run => <div key={run.id} className={"find-run find-" + run.status}>
      <div className="find-run-head"><strong>{run.name || run.keywords}</strong><span>{[run.city, run.state, run.country].filter(Boolean).join(", ")}</span><span className="find-badge">{run.status}</span></div>
      <small>{run.queryCount} search{run.queryCount === 1 ? "" : "es"} · {run.runner}{run.elapsedSeconds !== null ? " · " + formatElapsed(run.elapsedSeconds) : ""}{run.status === "completed" ? " · " + run.imported + " imported, " + run.duplicates + " already saved" : ""}</small>
      {isActive(run) && run.log.length > 0 && <pre className="find-log">{run.log.join("\n")}</pre>}
      {run.error && <small className="find-error">{run.error}</small>}
      {run.status !== "running" && run.status !== "importing" && <div className="find-run-actions">{run.collectionId && <button className="secondary-button" onClick={() => onOpenCollection(run.collectionId!)}>Open results</button>}<button className="secondary-button" disabled={!!active} onClick={() => void rerun(run.id)}>Run again</button></div>}
      {run.status === "running" && <button className="secondary-button" onClick={() => void cancel(run.id)}>Stop</button>}
    </div>)}</div>}
    <p className="helper-text">Results arrive as unverified records marked with their Google Maps link. Re-running a search skips businesses already in your directory.</p>
  </section>;
}
