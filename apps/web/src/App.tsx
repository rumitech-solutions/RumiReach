import { useEffect, useMemo, useRef, useState } from "react";
import FindLeads from "./FindLeads";
import Collections from "./Collections";
import WhatsAppService from "./WhatsAppService";

type Candidate = { id: string; name: string | null; category: string | null; address: string | null; phone_raw: string | null; website_url: string | null; public_email: string | null; source_url: string; observed_at: string; review_status: string; whatsapp_consent_status: string; whatsapp_consent_at?: string | null };
type DirectoryResponse = { items: Candidate[]; total: number; page: number; pageSize: number; totalPages: number; categories: string[]; stats: { total: number; accepted: number; pending: number; withPhone: number; withWebsite: number } };
type CsvRow = Record<string, string>;
const PAGE_SIZE = 25;
const VIEWS = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "find", label: "Find leads", icon: "⌕" },
  { id: "import", label: "Import CSV", icon: "⇧" },
  { id: "collections", label: "Collections", icon: "❏" },
  { id: "leads", label: "All businesses", icon: "▤" }
] as const;
type ViewId = typeof VIEWS[number]["id"];
function viewFromHash(): ViewId { const id = window.location.hash.replace("#", ""); return (VIEWS.find(item => item.id === id)?.id) || "overview"; }
const DEFAULT_WHATSAPP_DRAFT = "Assalam-o-Alaikum {business_name},\\n\\nI’m reaching out from RumiTech Solutions. We help businesses with websites, software and digital solutions. Would you be open to a brief conversation about your business needs?\\n\\nThank you,\\nRumiTech Solutions";
function csvCell(value: unknown) { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }
function formatCount(value: number) { return new Intl.NumberFormat().format(value || 0); }
function whatsappNumber(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "92" + digits.slice(1);
  else if (digits.length === 10 && digits.startsWith("3")) digits = "92" + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}
function makeWhatsAppMessage(draft: string, candidate: Candidate) {
  return draft.replace(/\{business_name\}/gi, candidate.name || "there").replace(/\{category\}/gi, candidate.category || "your business").trim();
}

const MEDIA_DB_NAME = "rumireach-media";
const MEDIA_STORE_NAME = "assets";
const OUTREACH_IMAGE_KEY = "whatsapp-outreach-image";
const MAX_OUTREACH_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_OUTREACH_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function openMediaDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MEDIA_STORE_NAME)) request.result.createObjectStore(MEDIA_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local image storage."));
  });
}

async function persistOutreachImage(file: File | null) {
  const database = await openMediaDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE_NAME, "readwrite");
    const store = transaction.objectStore(MEDIA_STORE_NAME);
    if (file) store.put(file, OUTREACH_IMAGE_KEY);
    else store.delete(OUTREACH_IMAGE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not save the outreach image."));
    transaction.onabort = () => reject(transaction.error || new Error("Image storage transaction was cancelled."));
  }).finally(() => database.close());
}

async function restoreOutreachImage(): Promise<File | null> {
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(MEDIA_STORE_NAME, "readonly").objectStore(MEDIA_STORE_NAME).get(OUTREACH_IMAGE_KEY);
    request.onsuccess = () => {
      const stored = request.result as Blob | undefined;
      database.close();
      resolve(stored ? new File([stored], (stored as File).name || "rumireach-outreach-image", { type: stored.type || "image/jpeg" }) : null);
    };
    request.onerror = () => { database.close(); reject(request.error || new Error("Could not restore the outreach image.")); };
  });
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function normalizeCsvRow(row: CsvRow): CsvRow {
  return {
    ...row,
    name: (row.name || row.business_name || row.title || row.restaurant_name || row.business || "").trim(),
    category: (row.category || row.business_category || "").trim(),
    address: (row.address || row.full_address || row.complete_address || "").trim(),
    phone: (row.phone || row.phone_number || row.phone_raw || "").trim(),
    website: (row.website || row.website_url || "").trim(),
    email: (row.email || row.public_email || "").trim(),
    source_url: (row.source_url || row.link || row.maps_url || row.url || "").trim()
  };
}

async function readApiJson<T>(response: Response, action: string): Promise<T> {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(`${action}: local API returned an empty response (HTTP ${response.status}). Check that the RumiReach API is running at 127.0.0.1:4317, then restart the app.`);
  }
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    const preview = body.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`${action}: API returned a non-JSON response (HTTP ${response.status}). ${preview || "Check the API terminal for its error."}`);
  }
  if (!response.ok) throw new Error(data?.error || data?.message || `${action} failed (HTTP ${response.status}).`);
  return data as T;
}

async function streamCsvFile(file: File, sendBatch: (rows: CsvRow[], startRow: number) => Promise<void>) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "", field = "", row: string[] = [], quoted = false, headers: string[] | null = null;
  let batch: CsvRow[] = [], nextRow = 2, batchStart = 2;
  const emitRow = async () => {
    row.push(field); field = "";
    if (!row.some(value => value.trim() !== "")) { row = []; return; }
    if (!headers) {
      headers = row.map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "") : value).trim().toLowerCase());
      if (new Set(headers).size !== headers.length) throw new Error("CSV contains duplicate column names.");
      if (!["name", "business_name", "title", "restaurant_name", "business"].some(header => headers!.includes(header))) {
        throw new Error('CSV must include a business-name column: "name", "business_name", "title", "restaurant_name" or "business".');
      }
    } else {
      const rawRow = Object.fromEntries(headers.map((header, index) => [header, (row[index] ?? "").trim()]));
      batch.push(normalizeCsvRow(rawRow));
      nextRow++;
      if (batch.length >= 500) {
        await sendBatch(batch, batchStart);
        batchStart = nextRow;
        batch = [];
      }
    }
    row = [];
  };
  const processBuffer = async (final: boolean) => {
    let i = 0;
    const end = final ? buffer.length : Math.max(0, buffer.length - 1);
    while (i < end) {
      const ch = buffer[i];
      if (quoted) {
        if (ch === '"') {
          if (i + 1 >= buffer.length && !final) break;
          if (buffer[i + 1] === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field.length === 0) { quoted = true; i++; continue; }
      if (ch === ",") { row.push(field); field = ""; i++; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && buffer[i + 1] === "\n") i += 2; else i++;
        await emitRow(); continue;
      }
      if (ch === '"') throw new Error("Unexpected quote in an unquoted CSV field.");
      field += ch; i++;
    }
    buffer = buffer.slice(i);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      await processBuffer(false);
    }
    buffer += decoder.decode();
    await processBuffer(true);
    if (quoted) throw new Error("CSV contains an unclosed quoted field.");
    if (field.length || row.length) await emitRow();
    if (!headers) throw new Error("CSV is empty.");
    if (batch.length) await sendBatch(batch, batchStart);
  } finally {
    reader.releaseLock();
  }
}

export default function App() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<string[]>([]);
  const [stats, setStats] = useState({ total: 0, accepted: 0, pending: 0, withPhone: 0, withWebsite: 0 });
  const [page, setPage] = useState(1);
  const [view, setViewState] = useState<ViewId>(viewFromHash);
  const [collection, setCollection] = useState("");
  const [collectionOptions, setCollectionOptions] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [importName, setImportName] = useState("");
  const [has, setHas] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [review, setReview] = useState("all");
  const [sort, setSort] = useState("newest");
  const [whatsappDraft, setWhatsappDraft] = useState(() => localStorage.getItem("rumireach.whatsappDraft") || DEFAULT_WHATSAPP_DRAFT);
  const [whatsappImage, setWhatsappImage] = useState<File | null>(null);
  const [whatsappImagePreview, setWhatsappImagePreview] = useState("");
  const [wahaEnabled, setWahaEnabled] = useState(() => localStorage.getItem("rumireach.wahaEnabled") === "true");
  const [wahaStatus, setWahaStatus] = useState("WAHA is disabled. WhatsApp buttons open the editable draft.");
  const [wahaConnected, setWahaConnected] = useState(false);
  const [sendingId, setSendingId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => { const onHash = () => setViewState(viewFromHash()); window.addEventListener("hashchange", onHash); return () => window.removeEventListener("hashchange", onHash); }, []);
  function go(next: ViewId) { if (window.location.hash !== "#" + next) window.location.hash = next; else setViewState(next); window.scrollTo({ top: 0 }); }
  async function loadCollectionOptions() {
    try { const response = await fetch("/api/collections"); const data = await readApiJson<{ collections: Array<{ id: string; name: string; count: number }> }>(response, "Could not load collections"); setCollectionOptions(data.collections); } catch { /* optional */ }
  }
  useEffect(() => { void loadCollectionOptions(); }, [view, total]);
  useEffect(() => { localStorage.setItem("rumireach.whatsappDraft", whatsappDraft); }, [whatsappDraft]);
  useEffect(() => { void restoreOutreachImage().then(setWhatsappImage).catch(() => setError("Could not restore the saved WhatsApp image from this browser.")); }, []);
  useEffect(() => {
    if (!whatsappImage) { setWhatsappImagePreview(""); return; }
    const objectUrl = URL.createObjectURL(whatsappImage);
    setWhatsappImagePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [whatsappImage]);
  useEffect(() => { localStorage.setItem("rumireach.wahaEnabled", String(wahaEnabled)); if (!wahaEnabled) { setWahaConnected(false); setWahaStatus("WAHA is disabled. WhatsApp buttons open the editable draft."); return; } setWahaStatus("Checking WAHA connection…"); fetch("/api/whatsapp/status").then(r => r.json()).then(data => { setWahaConnected(Boolean(data.connected)); setWahaStatus(data.message || "WAHA status unavailable."); }).catch(() => setWahaStatus("Could not check WAHA connection.")); }, [wahaEnabled]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), search: query, sort });
    if (category !== "all") params.set("category", category);
    if (review !== "all") params.set("status", review);
    if (collection) params.set("collection", collection);
    if (has) params.set("has", has);
    fetch("/api/candidates?" + params.toString(), { signal: controller.signal })
      .then(response => readApiJson<DirectoryResponse>(response, "Could not load saved records"))
      .then(data => { setCandidates(data.items); setTotal(data.total); setTotalPages(Math.max(1, data.totalPages)); setCategories(data.categories); setStats(data.stats); setError(""); })
      .catch(reason => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Could not load records."); });
    return () => controller.abort();
  }, [page, query, category, review, sort, collection, has]);
  useEffect(() => { setSelected(new Set()); }, [page, query, category, review, sort, collection, has]);

  async function refresh(requestedPage = page) {
    const params = new URLSearchParams({ page: String(requestedPage), pageSize: String(PAGE_SIZE), search: query, sort });
    if (category !== "all") params.set("category", category);
    if (review !== "all") params.set("status", review);
    if (collection) params.set("collection", collection);
    if (has) params.set("has", has);
    const response = await fetch("/api/candidates?" + params.toString());
    const data = await readApiJson<DirectoryResponse>(response, "Could not load saved records");
    setCandidates(data.items); setTotal(data.total); setTotalPages(Math.max(1, data.totalPages)); setCategories(data.categories); setStats(data.stats);
  }

  async function importCsv() {
    if (!csvFile) return;
    setCsvBusy(true); setError(""); setMessage(""); setProgress("Preparing import…");
    let batchId = "";
    try {
      const started = await fetch("/api/import/csv/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: csvFile.name, name: importName.trim() || undefined }) });
      const session = await readApiJson<{ batchId: string }>(started, "Could not start CSV import");
      if (!session.batchId) throw new Error("The import API did not return a batch ID. Check the API terminal and try again.");
      batchId = session.batchId;
      let rowsSent = 0;
      await streamCsvFile(csvFile, async (rows, startRow) => {
        const response = await fetch("/api/import/csv/" + batchId + "/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows, startRow }) });
        await readApiJson<{ received: number }>(response, "Could not save CSV batch");
        rowsSent += rows.length;
        setProgress(formatCount(rowsSent) + " rows processed…");
      });
      const completed = await fetch("/api/import/csv/" + batchId + "/complete", { method: "POST" });
      const result = await readApiJson<{ imported: number; skipped: number; invalidWebsite: number }>(completed, "Could not complete CSV import");
      setMessage("Imported " + formatCount(result.imported) + " businesses. " + formatCount(result.skipped) + " blank-name rows skipped; " + formatCount(result.invalidWebsite) + " invalid website values ignored.");
      setCsvFile(null); setImportName(""); setPage(1);
      if (fileInput.current) fileInput.current.value = "";
      setProgress("");
      try {
        await refresh(1);
        setError("");
      } catch (reason) {
        const detail = reason instanceof Error ? reason.message : "Unknown directory refresh error.";
        setError("Import completed and saved, but the business directory could not refresh. " + detail + " Your imported records remain in the database.");
      }
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "CSV import failed.";
      setError(detail === "Failed to fetch"
        ? "Cannot reach the local RumiReach API. Confirm both API and web servers are running, then retry."
        : detail);
      setProgress("Import stopped. Already saved batches remain in the database.");
    } finally { setCsvBusy(false); }
  }

  function recheckWaha() {
    if (!wahaEnabled) return;
    fetch("/api/whatsapp/status").then(r => r.json()).then(data => { setWahaConnected(Boolean(data.connected)); setWahaStatus(data.message || "WAHA status unavailable."); }).catch(() => undefined);
  }

  async function removeDuplicates() {
    try {
      const found = await readApiJson<{ groups: number; removable: number }>(await fetch("/api/duplicates"), "Could not check for duplicates");
      if (!found.removable) { setMessage("No duplicates found."); return; }
      if (!window.confirm("Found " + found.removable + " duplicate record" + (found.removable === 1 ? "" : "s") + " in " + found.groups + " group" + (found.groups === 1 ? "" : "s") + " (same phone, or same name and address). Remove them and keep one of each? Reviewed records are kept first.")) return;
      const done = await readApiJson<{ removed: number }>(await fetch("/api/duplicates/remove", { method: "POST" }), "Could not remove duplicates");
      setMessage("Removed " + done.removed + " duplicate records."); setError("");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Duplicate cleanup failed."); }
  }

  async function bulk(action: string) {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === "delete" && !window.confirm("Delete " + ids.length + " selected businesses? This cannot be undone.")) return;
    const response = await fetch("/api/candidates/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, action }) });
    if (!response.ok) { setError("Could not update the selected businesses."); return; }
    setSelected(new Set());
    void refresh().catch(reason => setError(reason.message));
  }

  async function deleteBusiness(candidate: Candidate) {
    if (!window.confirm("Delete " + (candidate.name || "this business") + " from your directory?")) return;
    const response = await fetch("/api/candidates/" + candidate.id, { method: "DELETE" });
    if (!response.ok) { setError("Could not delete the business."); return; }
    void refresh().catch(reason => setError(reason.message));
  }

  async function setReviewStatus(id: string, status: string) {
    const response = await fetch("/api/candidates/" + id + "/review", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) { setError("Could not update review status."); return; }
    setCandidates(rows => rows.map(item => item.id === id ? { ...item, review_status: status } : item));
    void refresh().catch(reason => setError(reason.message));
  }

  async function setWhatsAppConsent(candidate: Candidate, status: "opted_in" | "opted_out") {
    let evidence = "";
    if (status === "opted_in") { const answer = window.prompt("Record consent evidence (e.g. customer requested WhatsApp contact on 17 Nov 2026). A public phone number is NOT consent."); if (!answer || answer.trim().length < 5) return; evidence = answer.trim(); }
    else if (!window.confirm("Mark this contact as opted out? Future WhatsApp sends will be blocked.")) return;
    const response = await fetch("/api/candidates/" + candidate.id + "/whatsapp-consent", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, evidence, method: "operator_attestation" }) });
    const data = await response.json(); if (!response.ok) { setError(data.error || "Could not save consent."); return; }
    setCandidates(rows => rows.map(item => item.id === candidate.id ? { ...item, whatsapp_consent_status: status } : item));
    setMessage(status === "opted_in" ? "Opt-in consent evidence saved." : "Contact suppressed from WhatsApp sending.");
  }

  async function chooseWhatsappImage(file?: File) {
    if (!file) return;
    if (!ALLOWED_OUTREACH_IMAGE_TYPES.includes(file.type)) { setError("Choose a JPG, PNG or WebP image."); if (imageInput.current) imageInput.current.value = ""; return; }
    if (file.size > MAX_OUTREACH_IMAGE_BYTES) { setError("The shared image must be 5 MB or smaller."); if (imageInput.current) imageInput.current.value = ""; return; }
    try {
      await persistOutreachImage(file);
      setWhatsappImage(file);
      setError("");
      setMessage("Shared WhatsApp image saved in this browser.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the WhatsApp image.");
    }
  }

  async function clearWhatsappImage() {
    try {
      await persistOutreachImage(null);
      setWhatsappImage(null);
      if (imageInput.current) imageInput.current.value = "";
      setMessage("Shared image removed.");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the saved image.");
    }
  }

  async function sendWhatsApp(candidate: Candidate) {
    if (!wahaConnected) { setError("WAHA is not connected. Configure and start WAHA first."); return; }
    if (candidate.whatsapp_consent_status !== "opted_in") { setError("Only explicitly opted-in contacts can receive WhatsApp messages."); return; }
    const message = makeWhatsAppMessage(whatsappDraft, candidate);
    if (!window.confirm("Send this " + (whatsappImage ? "image and caption" : "message") + " to " + (candidate.name || "this contact") + " via your connected WhatsApp account?")) return;
    setSendingId(candidate.id); setError(""); setMessage("");
    try {
      const image = whatsappImage ? { data: await fileToBase64(whatsappImage), mimetype: whatsappImage.type, filename: whatsappImage.name } : undefined;
      const response = await fetch("/api/candidates/" + candidate.id + "/whatsapp-send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, ...(image ? { image } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "WhatsApp send failed.");
      setMessage((whatsappImage ? "Image and caption sent to " : "WhatsApp message sent to ") + (candidate.name || "contact") + ".");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "WhatsApp send failed."); } finally { setSendingId(""); }
  }

  async function openWhatsApp(candidate: Candidate) {
    const phone = whatsappNumber(candidate.phone_raw || "");
    if (!phone) { setError("This business does not have a usable phone number."); return; }
    const text = makeWhatsAppMessage(whatsappDraft, candidate);
    // Always open the recipient-specific WhatsApp chat. The Web Share API opens
    // a generic "Send message to" picker and drops the target phone number.
    window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(text), "_blank", "noopener,noreferrer");
    if (whatsappImage) {
      const imageUrl = URL.createObjectURL(whatsappImage);
      const download = document.createElement("a");
      download.href = imageUrl;
      download.download = whatsappImage.name || "rumireach-outreach-image";
      download.click();
      window.setTimeout(() => URL.revokeObjectURL(imageUrl), 1500);
      setMessage("WhatsApp draft opened and the shared image downloaded. Attach the downloaded image in the chat before sending.");
    }
  }
  function chooseFile(file?: File) { if (file && file.name.toLowerCase().endsWith(".csv")) { setCsvFile(file); setMessage(""); setError(""); setProgress(""); } }
  const pageRows = useMemo(() => candidates, [candidates]);
  function exportCsv() {
    const params = new URLSearchParams({ search: query, sort });
    if (category !== "all") params.set("category", category);
    if (review !== "all") params.set("status", review);
    if (collection) params.set("collection", collection);
    if (has) params.set("has", has);
    const anchor = document.createElement("a");
    anchor.href = "/api/candidates/export?" + params.toString();
    anchor.download = "rumireach-leads.csv";
    anchor.click();
  }

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">R</span><span><strong>RumiReach</strong><small>BY RUMITECH</small></span></div>
      <div className="workspace-label">WORKSPACE</div><nav>{VIEWS.map(item => <a key={item.id} className={"nav-item" + (view === item.id ? " active" : "")} href={"#" + item.id} onClick={event => { event.preventDefault(); go(item.id); }}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === "leads" && <span className="nav-count">{formatCount(stats.total)}</span>}{item.id === "collections" && <span className="nav-count">{collectionOptions.length}</span>}</a>)}</nav>
      <div className="sidebar-bottom"><div className="storage-card"><span className="storage-icon">◈</span><strong>Your data stays local</strong><p>Business records are stored in your local RumiReach workspace.</p><span className="storage-status"><i/> LOCAL DATABASE</span></div><div className="profile"><span className="avatar">R</span><span><strong>RumiTech Solutions</strong><small>Workspace owner</small></span><span className="profile-dots">···</span></div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>{VIEWS.find(item => item.id === view)?.label}</strong></div><div className="top-actions"><span className="secure-pill"><i/> Private workspace</span><button className="icon-button" title="Refresh records" onClick={() => void refresh().catch(e => setError(e.message))}>↻</button></div></header>
      <div className="content"><div hidden={view !== "overview"}><section className="welcome-row"><div><div className="eyebrow"><span/> LEAD MANAGEMENT WORKSPACE</div><h1>Good work starts with <em>good leads.</em></h1><p>Bring your business data together. Import, organize, review and manage every opportunity in one place.</p></div><button className="primary-button" onClick={() => go("find")}><span>⌕</span> Find leads</button></section>
        <section className="stats-grid"><article className="stat-card"><div className="stat-top"><span>Total businesses</span><span className="stat-icon teal">▤</span></div><strong>{formatCount(stats.total)}</strong><small>Records in your workspace</small></article><article className="stat-card"><div className="stat-top"><span>Accepted leads</span><span className="stat-icon green">✓</span></div><strong>{formatCount(stats.accepted)}</strong><small>Approved for follow-up</small></article><article className="stat-card"><div className="stat-top"><span>Pending review</span><span className="stat-icon amber">◷</span></div><strong>{formatCount(stats.pending)}</strong><small>Awaiting your decision</small></article><article className="stat-card"><div className="stat-top"><span>Have phone numbers</span><span className="stat-icon blue">⌕</span></div><strong>{formatCount(stats.withPhone)}</strong><small>{stats.total ? Math.round(stats.withPhone / stats.total * 100) : 0}% of all records</small></article></section>
          <section className="quick-grid"><button className="quick-card" onClick={() => go("find")}><span>⌕</span><strong>Find leads</strong><small>Search by keyword, country, state and city.</small></button><button className="quick-card" onClick={() => go("import")}><span>⇧</span><strong>Import a CSV</strong><small>Upload your own list and name it.</small></button><button className="quick-card" onClick={() => go("collections")}><span>❏</span><strong>Collections</strong><small>{collectionOptions.length} saved search{collectionOptions.length === 1 ? "" : "es"} and imports.</small></button><button className="quick-card" onClick={() => go("leads")}><span>▤</span><strong>All businesses</strong><small>Review, filter and message your leads.</small></button></section>
          {collectionOptions.length > 0 && <section className="panel recent-panel"><div className="section-heading"><div><span className="section-kicker">RECENT</span><h2>Your latest collections</h2></div><button className="secondary-button" onClick={() => go("collections")}>See all →</button></div><div className="recent-list">{collectionOptions.slice(0, 5).map(item => <button key={item.id} className="recent-item" onClick={() => { setCollection(item.id); setPage(1); go("leads"); }}><strong>{item.name}</strong><span>{item.count.toLocaleString()} businesses →</span></button>)}</div></section>}
        </div>
        <div hidden={view !== "find"}><FindLeads onImported={() => { void refresh().catch(e => setError(e.message)); void loadCollectionOptions(); }} onOpenCollection={id => { setCollection(id); setPage(1); go("leads"); }}/></div>
        <div hidden={view !== "collections"}><Collections active={view === "collections"} onOpen={id => { setCollection(id); setPage(1); go("leads"); }} onChanged={() => { void refresh().catch(e => setError(e.message)); void loadCollectionOptions(); }}/></div>
        <div hidden={view !== "import"}>
        <section className="panel import-panel" id="import"><div className="section-heading"><div><span className="section-kicker">02 / DATA INTAKE</span><h2>Bring your leads in</h2><p>Upload a CSV and let RumiReach organize the details for you.</p></div><span className="format-badge">CSV FILE</span></div>
          <div className={"dropzone" + (dragging ? " drag-active" : "")} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0]); }} onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.current?.click(); } }}>
            <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={e => chooseFile(e.target.files?.[0])}/><div className="upload-symbol"><span>↑</span></div><strong>{csvFile ? csvFile.name : "Drop your CSV file here"}</strong><p>{csvFile ? "Ready to import · " + (csvFile.size / 1024 / 1024).toFixed(2) + " MB" : "or click to browse files on your computer"}</p><span className="browse-button">Choose a file</span>
          </div><div className="import-meta"><span><b>↳</b> Streaming file reader</span><span><b>✓</b> No fixed row or file-size cap</span><span><b>◈</b> Batched local database writes</span></div>
          <label className="find-field import-name"><span>Save this list as (optional)</span><input value={importName} maxLength={100} onChange={event => setImportName(event.target.value)} placeholder={csvFile ? csvFile.name.replace(/\.csv$/i, "") : "e.g. Karachi restaurants"}/></label>
          <div className="import-actions">{message && <div className="inline-success">✓ {message}</div>}{error && <div className="inline-error">{error}</div>}{progress && <div className="import-progress">{progress}</div>}<div className="import-submit"><span className="selected-file">{csvFile ? "Selected and ready" : "CSV files · UTF-8 supported"}</span><button className="primary-button" disabled={!csvFile || csvBusy} onClick={() => void importCsv()}>{csvBusy ? "Importing…" : "Import dataset"} <span>→</span></button></div></div>
          <p className="helper-text">Required column: <code>name</code>, <code>business_name</code> or <code>title</code>. Also accepts restaurant_name/business, complete_address, phone_number, website_url and Maps link columns. Imported details are marked unverified until reviewed.</p>
        </section>
        </div>
        <div hidden={view !== "leads"}><section className="panel leads-panel" id="leads"><div className="section-heading leads-heading"><div><span className="section-kicker">03 / YOUR DATABASE</span><h2>Business directory <span className="count-pill">{formatCount(total)}</span></h2><p>Search, browse and export your full filtered dataset without loading every record at once.</p></div><button className="secondary-button" disabled={!candidates.length} onClick={exportCsv}>↓ <span>Export CSV</span></button></div>
          <div className="whatsapp-composer">
            <div className="whatsapp-composer-heading"><div><span className="section-kicker">04 / PERSONAL OUTREACH</span><h3>WhatsApp message draft</h3><p>One editable message and one reusable image for every business. Both are saved in this browser and the text is personalized with each business name.</p></div><button className="draft-reset" onClick={() => setWhatsappDraft(DEFAULT_WHATSAPP_DRAFT)}>Reset template</button></div>
            <textarea aria-label="Editable WhatsApp message draft" value={whatsappDraft} onChange={e => setWhatsappDraft(e.target.value)} placeholder="Write your WhatsApp message…"/>
            <div className="image-attachment">
              <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => void chooseWhatsappImage(e.target.files?.[0])}/>
              <div className="image-attachment-preview">
                {whatsappImagePreview ? <img src={whatsappImagePreview} alt="Shared WhatsApp attachment preview"/> : <span className="image-attachment-placeholder">▧</span>}
                <div><strong>{whatsappImage ? whatsappImage.name : "No shared image selected"}</strong><small>{whatsappImage ? (whatsappImage.size / 1024 / 1024).toFixed(2) + " MB · Used for every business" : "Add one JPG, PNG or WebP image for all business drafts (max 5 MB)."}</small></div>
              </div>
              <div className="image-attachment-actions">
                <button className="draft-reset" onClick={() => imageInput.current?.click()}>{whatsappImage ? "Change image" : "＋ Add shared image"}</button>
                {whatsappImage && <button className="draft-reset image-remove" onClick={() => void clearWhatsappImage()}>Remove</button>}
              </div>
            </div>
            <p className="image-attachment-help">RumiReach opens a direct chat with this business and pre-fills your message. The shared image downloads separately; attach it in the chat before sending.</p>
            <div className="draft-footer"><span>Use <code>{'{business_name}'}</code> and <code>{'{category}'}</code> to personalize each message.</span><span className="draft-saved"><i/> Saved in this browser</span></div><details className="waha-settings"><summary><span>Optional integration settings</span><span className="waha-mode">{wahaEnabled ? "WAHA enabled" : "Draft mode · default"}</span></summary><div className="waha-settings-body"><label className="waha-toggle"><input type="checkbox" checked={wahaEnabled} onChange={e => setWahaEnabled(e.target.checked)}/><span><strong>Enable WAHA sending</strong><small>Off by default. When disabled, every WhatsApp button opens your editable draft in WhatsApp.</small></span></label><div className={"waha-status" + (wahaConnected ? " connected" : "")}><span>{wahaConnected ? "●" : "○"}</span> {wahaStatus}</div><WhatsAppService active={wahaEnabled} onConnectedChange={recheckWaha}/><p>Advanced: instead of the button above you can run your own WAHA and set <code>WAHA_BASE_URL</code>, <code>WAHA_SESSION</code> and <code>WAHA_API_KEY</code> in the local API environment. The API key stays server-side. After enabling, contacts still need recorded opt-in consent before the separate WAHA send action is available. The selected shared image is sent with the personalized draft as its caption.</p></div></details>
          </div>
          <div className="filter-bar"><div className="search-box"><span>⌕</span><input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search businesses, phone, location…"/></div><select aria-label="Collection filter" value={collection} onChange={e => { setCollection(e.target.value); setPage(1); }}><option value="">All collections</option>{collectionOptions.map(item => <option key={item.id} value={item.id}>{item.name} ({item.count})</option>)}</select><select aria-label="Category filter" value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}><option value="all">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Review filter" value={review} onChange={e => { setReview(e.target.value); setPage(1); }}><option value="all">All statuses</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="contacted">Contacted</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select><select aria-label="Sort records" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="newest">Recently added</option><option value="name">Business name</option><option value="category">Category</option></select></div>
          <div className="chip-row"><button className="chip dupe-chip" onClick={() => void removeDuplicates()}>⧉ Clean duplicates</button><span>Show only:</span>{([["", "Everyone"], ["phone", "Has phone"], ["website", "Has website"], ["email", "Has email"]] as const).map(([value, label]) => <button key={value} className={"chip" + (has === value ? " on" : "")} onClick={() => { setHas(value); setPage(1); }}>{label}</button>)}</div>
          {selected.size > 0 && <div className="bulk-bar"><strong>{selected.size} selected</strong><button className="secondary-button" onClick={() => void bulk("accepted")}>✓ Accept</button><button className="secondary-button" onClick={() => void bulk("contacted")}>Mark contacted</button><button className="secondary-button" onClick={() => void bulk("rejected")}>Reject</button><button className="secondary-button" onClick={() => void bulk("needs_review")}>Needs review</button><button className="secondary-button danger" onClick={() => void bulk("delete")}>Delete</button><button className="secondary-button" onClick={() => setSelected(new Set())}>Clear</button></div>}
          {!pageRows.length ? <div className="empty-state"><div className="empty-art">▤</div><strong>{stats.total ? "No matching businesses" : "Your directory starts here"}</strong><p>{stats.total ? "Try another search or adjust your filters." : "Import your first CSV dataset to see your business records appear here."}</p><button className="secondary-button" onClick={() => go("import")}>Import a CSV <span>→</span></button></div> : <div className="table-scroll"><table><thead><tr><th className="check-col"><input type="checkbox" aria-label="Select all on this page" checked={pageRows.length > 0 && pageRows.every(row => selected.has(row.id))} onChange={event => setSelected(event.target.checked ? new Set(pageRows.map(row => row.id)) : new Set())}/></th><th>BUSINESS</th><th>LOCATION</th><th>CONTACT</th><th>ONLINE PRESENCE</th><th>STATUS</th><th>WHATSAPP CONSENT</th><th></th><th></th></tr></thead><tbody>{pageRows.map(c => <tr key={c.id} className={selected.has(c.id) ? "row-selected" : ""}><td className="check-col"><input type="checkbox" aria-label={"Select " + c.name} checked={selected.has(c.id)} onChange={event => setSelected(prev => { const next = new Set(prev); if (event.target.checked) next.add(c.id); else next.delete(c.id); return next; })}/></td><td><div className="business-cell"><span className="business-avatar">{(c.name || "?").trim().charAt(0).toUpperCase()}</span><span><strong>{c.name || "Unnamed business"}</strong><small>{c.category || "Uncategorized"}</small></span></div></td><td><span className="address-cell">{c.address || "—"}</span></td><td><div className="contact-actions">{c.phone_raw ? <><a className="phone-link" href={"tel:" + c.phone_raw}>{c.phone_raw}</a><button className="whatsapp-button" onClick={() => openWhatsApp(c)} title={"Open WhatsApp draft for " + c.name}>◉ WhatsApp</button></> : <span className="no-phone">No phone number</span>}</div></td><td>{c.website_url ? <a className="website-link" href={c.website_url} target="_blank" rel="noreferrer">Visit website ↗</a> : c.public_email ? <a className="website-link" href={"mailto:" + c.public_email}>{c.public_email}</a> : "—"}{c.public_email && c.website_url && <small className="email-sub">{c.public_email}</small>}</td><td><select className={"status-select status-" + c.review_status} aria-label={"Review status for " + c.name} value={c.review_status} onChange={e => void setReviewStatus(c.id, e.target.value)}><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="contacted">Contacted</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select></td><td><div className="consent-actions"><select aria-label={"WhatsApp consent for " + c.name} value={c.whatsapp_consent_status || "not_confirmed"} onChange={e => { if (e.target.value === "opted_in" || e.target.value === "opted_out") void setWhatsAppConsent(c, e.target.value); }}><option value="not_confirmed">Not confirmed</option><option value="opted_in">Opted in</option><option value="opted_out">Opted out</option></select>{wahaEnabled && c.whatsapp_consent_status === "opted_in" && <button className="whatsapp-button" disabled={!wahaConnected || sendingId === c.id} onClick={() => void sendWhatsApp(c)}>{sendingId === c.id ? "Sending…" : "Send via WAHA"}</button>}</div></td><td><span className="row-menu" title={"Imported " + new Date(c.observed_at).toLocaleDateString()}>···</span></td><td><button className="row-delete" title="Delete business" onClick={() => void deleteBusiness(c)}>✕</button></td></tr>)}</tbody></table></div>}
          <div className="table-footer"><span>Showing <strong>{formatCount(total ? (page - 1) * PAGE_SIZE + 1 : 0)}–{formatCount(Math.min(page * PAGE_SIZE, total))}</strong> of <strong>{formatCount(total)}</strong> businesses</span><div className="pagination"><button disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>← Previous</button><span>Page {page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>Next →</button></div></div>
        </section>
        </div>
        <footer className="app-footer"><span>© {new Date().getFullYear()} RumiReach · RumiTech Solutions</span><span>Built for better business connections.</span></footer>
        <span className="sr-only">{formatCount(stats.withWebsite)} records include a website.</span>
      </div>
    </main>
  </div>;
}
