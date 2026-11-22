import { useEffect, useMemo, useRef, useState } from "react";
import FindLeads from "./FindLeads";
import Collections from "./Collections";
import WhatsAppService from "./WhatsAppService";
import { ConfirmHost, Toasts, confirmDialog } from "./ui";
import Updates from "./Updates";

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
const DEFAULT_WHATSAPP_DRAFT = "Assalam-o-Alaikum {business_name},\n\nI’m reaching out from RumiTech Solutions. We help businesses with websites, software and digital solutions. Would you be open to a brief conversation about your business needs?\n\nThank you,\nRumiTech Solutions";
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
  return draft.replace(/\\n/g, "\n").replace(/\{business_name\}/gi, candidate.name || "there").replace(/\{category\}/gi, candidate.category || "your business").trim();
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
  const hasTokens = has ? has.split(",") : [];
  /** Contact filters: each field is Any / Has / None, and the three combine (AND). */
  type ContactField = "phone" | "website" | "email";
  const contactMode = (field: ContactField): "any" | "has" | "no" => hasTokens.includes(field) ? "has" : hasTokens.includes("no" + field) ? "no" : "any";
  function setContactMode(field: ContactField, mode: "any" | "has" | "no") {
    const rest = hasTokens.filter(token => token !== field && token !== "no" + field);
    setHas((mode === "any" ? rest : [...rest, mode === "has" ? field : "no" + field]).join(",")); setPage(1);
  }

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
      .then(data => { setCandidates(data.items); setTotal(data.total); setTotalPages(Math.max(1, data.totalPages)); setCategories(data.categories); setStats(data.stats); setError(""); setLoading(false); })
      .catch(reason => { if (!(reason instanceof DOMException && reason.name === "AbortError")) { setLoading(false); setError(reason instanceof Error ? reason.message : "Could not load records."); } });
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
      if (!await confirmDialog({ title: "Remove " + found.removable + " duplicate" + (found.removable === 1 ? "" : "s") + "?", body: "Found in " + found.groups + " group" + (found.groups === 1 ? "" : "s") + " (same phone, or same name and address). One of each is kept, and reviewed records are kept first.", confirmLabel: "Remove duplicates", danger: true })) return;
      const done = await readApiJson<{ removed: number }>(await fetch("/api/duplicates/remove", { method: "POST" }), "Could not remove duplicates");
      setMessage("Removed " + done.removed + " duplicate records."); setError("");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Duplicate cleanup failed."); }
  }

  async function bulk(action: string) {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === "delete" && !await confirmDialog({ title: "Delete " + ids.length.toLocaleString() + " selected business" + (ids.length === 1 ? "" : "es") + "?", body: "This cannot be undone.", confirmLabel: "Delete", danger: true })) return;
    const response = await fetch("/api/candidates/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, action }) });
    if (!response.ok) { setError("Could not update the selected businesses."); return; }
    setSelected(new Set());
    void refresh().catch(reason => setError(reason.message));
  }

  async function deleteBusiness(candidate: Candidate) {
    if (!await confirmDialog({ title: "Delete " + (candidate.name || "this business") + "?", body: "It is removed from your directory. This cannot be undone.", confirmLabel: "Delete", danger: true })) return;
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

  type SendJob = { id: string; state: "running" | "done" | "cancelled"; total: number; sent: number; failed: number; skipped: number; nextSendInSeconds: number; items: Array<{ id: string; name: string; status: string; note?: string }> };
  const [loading, setLoading] = useState(true);
  const [sendJob, setSendJob] = useState<SendJob | null>(null);
  const [sendGap, setSendGap] = useState(() => { const saved = Number(localStorage.getItem("rumireach.sendGap")); return saved >= 1 && saved <= 3600 ? saved : 20; });
  const [sendVary, setSendVary] = useState(() => localStorage.getItem("rumireach.sendVary") !== "false");
  useEffect(() => { localStorage.setItem("rumireach.sendGap", String(sendGap)); localStorage.setItem("rumireach.sendVary", String(sendVary)); }, [sendGap, sendVary]);
  const jobRunning = sendJob?.state === "running";
  useEffect(() => {
    let alive = true;
    const poll = () => fetch("/api/whatsapp/send/current").then(r => r.json()).then(data => { if (!alive) return; setSendJob(prev => { if (prev?.state === "running" && data.job && data.job.state !== "running") { void refresh().catch(() => undefined); setMessage("WhatsApp sending " + (data.job.state === "cancelled" ? "stopped" : "finished") + ": " + data.job.sent + " sent" + (data.job.failed ? ", " + data.job.failed + " failed" : "") + (data.job.skipped ? ", " + data.job.skipped + " skipped" : "") + "."); } return data.job; }); }).catch(() => undefined);
    void poll();
    const timer = setInterval(poll, jobRunning ? 1500 : 8000);
    return () => { alive = false; clearInterval(timer); };
  }, [jobRunning]);

  function filterParams() {
    const params = new URLSearchParams({ search: query, sort });
    if (category !== "all") params.set("category", category);
    if (review !== "all") params.set("status", review);
    if (collection) params.set("collection", collection);
    if (has) params.set("has", has);
    return params;
  }
  const [selectingAll, setSelectingAll] = useState(false);
  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const data = await readApiJson<{ ids: string[]; capped: boolean }>(await fetch("/api/candidates/ids?" + filterParams().toString()), "Could not select all matching businesses");
      setSelected(new Set(data.ids));
      if (data.capped) setMessage("Selected the first " + formatCount(data.ids.length) + " matching businesses (the maximum at once).");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not select all matching businesses."); }
    finally { setSelectingAll(false); }
  }
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (event.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") { event.preventDefault(); go("leads"); setTimeout(() => searchInput.current?.focus(), 30); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function sendSelectedViaWaha() {
    const ids = [...selected]; if (!ids.length) return;
    if (!wahaEnabled || !wahaConnected) { setError(!wahaEnabled ? "Turn on WAHA sending first: open Optional integration settings above and tick Enable WAHA sending." : "WhatsApp is not connected yet. Open Optional integration settings above and scan the QR code."); return; }
    setError(""); setMessage("");
    try {
      const image = whatsappImage ? { data: await fileToBase64(whatsappImage), mimetype: whatsappImage.type, filename: whatsappImage.name } : undefined;
      const response = await fetch("/api/whatsapp/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, template: whatsappDraft, gapSeconds: sendGap, vary: sendVary, ...(image ? { image } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start sending.");
      setSendJob(data); setSelected(new Set());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start sending."); }
  }
  async function cancelSend() { await fetch("/api/whatsapp/send/cancel", { method: "POST" }).catch(() => undefined); }

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
    <main className="main-area"><header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>{VIEWS.find(item => item.id === view)?.label}</strong></div><div className="top-actions">{wahaEnabled && <button className={"wa-pill" + (wahaConnected ? " on" : "")} title={wahaConnected ? "WhatsApp is connected" : "WhatsApp is not connected. Open Optional integration settings in All businesses."} onClick={() => go("leads")}><i/>{wahaConnected ? "WhatsApp connected" : "WhatsApp not connected"}</button>}<span className="secure-pill"><i/> Private workspace</span><button className="icon-button" title="Refresh records" onClick={() => void refresh().catch(e => setError(e.message))}>↻</button></div></header>
      <div className="content"><div hidden={view !== "overview"}><section className="welcome-row"><div><div className="eyebrow"><span/> LEAD MANAGEMENT WORKSPACE</div><h1>Good work starts with <em>good leads.</em></h1><p>Bring your business data together. Import, organize, review and manage every opportunity in one place.</p></div><button className="primary-button" onClick={() => go("find")}><span>⌕</span> Find leads</button></section>
        <section className="stats-grid"><article className="stat-card"><div className="stat-top"><span>Total businesses</span><span className="stat-icon teal">▤</span></div><strong>{formatCount(stats.total)}</strong><small>Records in your workspace</small></article><article className="stat-card"><div className="stat-top"><span>Accepted leads</span><span className="stat-icon green">✓</span></div><strong>{formatCount(stats.accepted)}</strong><small>Approved for follow-up</small></article><article className="stat-card"><div className="stat-top"><span>Pending review</span><span className="stat-icon amber">◷</span></div><strong>{formatCount(stats.pending)}</strong><small>Awaiting your decision</small></article><article className="stat-card"><div className="stat-top"><span>Have phone numbers</span><span className="stat-icon blue">⌕</span></div><strong>{formatCount(stats.withPhone)}</strong><small>{stats.total ? Math.round(stats.withPhone / stats.total * 100) : 0}% of all records</small></article></section>
          <section className="quick-grid"><button className="quick-card" onClick={() => go("find")}><span>⌕</span><strong>Find leads</strong><small>Search by keyword, country, state and city.</small></button><button className="quick-card" onClick={() => go("import")}><span>⇧</span><strong>Import a CSV</strong><small>Upload your own list and name it.</small></button><button className="quick-card" onClick={() => go("collections")}><span>❏</span><strong>Collections</strong><small>{collectionOptions.length} saved search{collectionOptions.length === 1 ? "" : "es"} and imports.</small></button><button className="quick-card" onClick={() => go("leads")}><span>▤</span><strong>All businesses</strong><small>Review, filter and message your leads.</small></button></section>
          <Updates/>
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
          <div className="import-actions">{progress && <div className="import-progress">{progress}</div>}<div className="import-submit"><span className="selected-file">{csvFile ? "Selected and ready" : "CSV files · UTF-8 supported"}</span><button className="primary-button" disabled={!csvFile || csvBusy} onClick={() => void importCsv()}>{csvBusy ? "Importing…" : "Import dataset"} <span>→</span></button></div></div>
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
            <p className="image-attachment-help">{wahaEnabled && wahaConnected ? "Tick businesses in the table below and press “Send via WhatsApp” to send this message (with the image as caption) automatically. The per-row WhatsApp button still opens a manual chat." : "The WhatsApp button on each row opens a direct chat with your message pre-filled. The shared image downloads separately; attach it in the chat before sending. Enable WAHA below to send automatically."}</p>
            {wahaEnabled && <div className="send-settings"><div className="send-settings-main"><label htmlFor="send-gap"><strong>Pause between messages</strong><small>Each selected business gets the message one after another, with this wait in between.</small></label><div className="gap-control"><input id="send-gap" type="number" min={1} max={3600} value={sendGap} onChange={event => setSendGap(Math.min(3600, Math.max(1, Math.round(Number(event.target.value)) || 1)))}/><span>seconds</span></div></div><div className="gap-presets" role="group" aria-label="Pause presets">{[5, 10, 20, 30, 60, 120].map(value => <button key={value} className={"chip" + (sendGap === value ? " on" : "")} aria-pressed={sendGap === value} onClick={() => setSendGap(value)}>{value < 60 ? value + "s" : value / 60 + " min"}</button>)}<label className="vary-toggle"><input type="checkbox" checked={sendVary} onChange={event => setSendVary(event.target.checked)}/> Vary slightly (up to 25%)</label></div></div>}
            <div className="draft-footer"><span>Use <code>{'{business_name}'}</code> and <code>{'{category}'}</code> to personalize each message.</span><span className="draft-saved"><i/> Saved in this browser</span></div><details className="waha-settings"><summary><span>Optional integration settings</span><span className="waha-mode">{wahaEnabled ? "WAHA enabled" : "Draft mode · default"}</span></summary><div className="waha-settings-body"><label className="waha-toggle"><input type="checkbox" checked={wahaEnabled} onChange={e => setWahaEnabled(e.target.checked)}/><span><strong>Enable WAHA sending</strong><small>Off by default. When disabled, every WhatsApp button opens your editable draft in WhatsApp.</small></span></label><div className={"waha-status" + (wahaConnected ? " connected" : "")}><span>{wahaConnected ? "●" : "○"}</span> {wahaStatus}</div><WhatsAppService active={wahaEnabled} onConnectedChange={recheckWaha}/></div></details>
          </div>
          {sendJob && <div className={"send-panel" + (jobRunning ? " running" : "")} role="status"><div className="send-panel-head"><strong>{jobRunning ? "Sending WhatsApp messages…" : sendJob.state === "cancelled" ? "Sending cancelled" : "Sending finished"}</strong><span>{sendJob.sent + sendJob.failed + sendJob.skipped} / {sendJob.total}</span>{jobRunning ? <button className="secondary-button danger" onClick={() => void cancelSend()}>Stop</button> : <button className="draft-reset" onClick={() => setSendJob(null)}>Dismiss</button>}</div><div className="send-bar"><i style={{ width: Math.round((sendJob.sent + sendJob.failed + sendJob.skipped) / Math.max(1, sendJob.total) * 100) + "%" }}/></div>{jobRunning && sendJob.items.find(item => item.status === "sending") && <div className="send-now">Sending to <b>{sendJob.items.find(item => item.status === "sending")?.name}</b></div>}<div className="send-counts"><span className="ok">✓ {sendJob.sent} sent</span><span className="bad">✕ {sendJob.failed} failed</span><span>↷ {sendJob.skipped} skipped</span>{jobRunning && sendJob.nextSendInSeconds > 0 && <span>Next message in {sendJob.nextSendInSeconds}s</span>}</div>{sendJob.items.some(item => item.status === "failed" || (item.status === "skipped" && item.note)) && <ul className="send-issues">{sendJob.items.filter(item => item.status === "failed" || (item.status === "skipped" && item.note)).slice(0, 8).map(item => <li key={item.id}><b>{item.name}</b> — {item.note || item.status}</li>)}</ul>}</div>}
          <div className="filter-bar"><div className="search-box"><span>⌕</span><input ref={searchInput} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search businesses, phone, location…"/><kbd>/</kbd></div><select aria-label="Collection filter" value={collection} onChange={e => { setCollection(e.target.value); setPage(1); }}><option value="">All collections</option>{collectionOptions.map(item => <option key={item.id} value={item.id}>{item.name} ({item.count})</option>)}</select><select aria-label="Category filter" value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}><option value="all">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Review filter" value={review} onChange={e => { setReview(e.target.value); setPage(1); }}><option value="all">All statuses</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="contacted">Contacted</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select><select aria-label="Sort records" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="newest">Recently added</option><option value="name">Business name</option><option value="category">Category</option></select></div>
          <div className="chip-row"><button className="chip dupe-chip" onClick={() => void removeDuplicates()}>⧉ Clean duplicates</button><div className="contact-filters" role="group" aria-label="Contact details filter">{([["phone", "Phone"], ["website", "Website"], ["email", "Email"]] as const).map(([field, label]) => <div key={field} className="seg-field"><span>{label}</span><div className="seg" role="radiogroup" aria-label={label + " filter"}>{([["any", "Any"], ["has", "Has " + label.toLowerCase()], ["no", "No " + label.toLowerCase()]] as const).map(([mode, text]) => <button key={mode} role="radio" aria-checked={contactMode(field) === mode} className={contactMode(field) === mode ? "on " + mode : ""} onClick={() => setContactMode(field, mode)}>{text}</button>)}</div></div>)}{hasTokens.length > 0 && <button className="chip" onClick={() => { setHas(""); setPage(1); }}>✕ Clear filters</button>}</div></div>
          {selected.size > 0 && <div className="bulk-bar"><strong>{selected.size} selected</strong><button className="primary-button send-button" disabled={jobRunning} title="Send your draft to every selected business" onClick={() => void sendSelectedViaWaha()}>◉ Send via WhatsApp ({selected.size})</button>{wahaEnabled && selected.size > 1 && <span className="send-eta">≈ {Math.max(1, Math.round((selected.size - 1) * sendGap * (sendVary ? 1.125 : 1) / 60))} min</span>}<button className="secondary-button" onClick={() => void bulk("accepted")}>✓ Accept</button><button className="secondary-button" onClick={() => void bulk("contacted")}>Mark contacted</button><button className="secondary-button" onClick={() => void bulk("rejected")}>Reject</button><button className="secondary-button" onClick={() => void bulk("needs_review")}>Needs review</button><button className="secondary-button danger" onClick={() => void bulk("delete")}>Delete</button><button className="secondary-button" onClick={() => setSelected(new Set())}>Clear</button></div>}
          {pageRows.length > 0 && selected.size >= pageRows.length && total > selected.size && <div className="select-banner">{selected.size === pageRows.length ? "All " + formatCount(pageRows.length) + " businesses on this page are selected." : formatCount(selected.size) + " selected."} <button disabled={selectingAll} onClick={() => void selectAllMatching()}>{selectingAll ? "Selecting…" : "Select all " + formatCount(total) + " matching"}</button></div>}{total > 0 && selected.size >= total && <div className="select-banner">All {formatCount(total)} matching businesses are selected. <button onClick={() => setSelected(new Set())}>Clear selection</button></div>}
          {loading && !pageRows.length ? <div className="skeleton-table" aria-busy="true" aria-label="Loading businesses">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton-row"><i/><span/><span/><span/></div>)}</div> : !pageRows.length ? <div className="empty-state"><div className="empty-art">▤</div><strong>{stats.total ? "No matching businesses" : "Your directory starts here"}</strong><p>{stats.total ? "Try another search or adjust your filters." : "Import your first CSV dataset to see your business records appear here."}</p><button className="secondary-button" onClick={() => go("import")}>Import a CSV <span>→</span></button></div> : <div className="table-scroll"><table><thead><tr><th className="check-col"><input type="checkbox" aria-label="Select all on this page" checked={pageRows.length > 0 && pageRows.every(row => selected.has(row.id))} onChange={event => setSelected(event.target.checked ? new Set(pageRows.map(row => row.id)) : new Set())}/></th><th>BUSINESS</th><th>LOCATION</th><th>CONTACT</th><th>ONLINE PRESENCE</th><th>STATUS</th><th></th></tr></thead><tbody>{pageRows.map(c => <tr key={c.id} className={selected.has(c.id) ? "row-selected" : ""}><td className="check-col"><input type="checkbox" aria-label={"Select " + c.name} checked={selected.has(c.id)} onChange={event => setSelected(prev => { const next = new Set(prev); if (event.target.checked) next.add(c.id); else next.delete(c.id); return next; })}/></td><td><div className="business-cell"><span className="business-avatar">{(c.name || "?").trim().charAt(0).toUpperCase()}</span><span><strong>{c.name || "Unnamed business"}</strong><small>{c.category || "Uncategorized"}</small></span></div></td><td><span className="address-cell">{c.address || "—"}</span></td><td><div className="contact-actions">{c.phone_raw ? <><a className="phone-link" href={"tel:" + c.phone_raw}>{c.phone_raw}</a><button className="whatsapp-button" onClick={() => openWhatsApp(c)} title={"Open WhatsApp draft for " + c.name}>◉ WhatsApp</button></> : <span className="no-phone">No phone number</span>}</div></td><td>{c.website_url ? <a className="website-link" href={c.website_url} target="_blank" rel="noreferrer">Visit website ↗</a> : c.public_email ? <a className="website-link" href={"mailto:" + c.public_email}>{c.public_email}</a> : "—"}{c.public_email && c.website_url && <small className="email-sub">{c.public_email}</small>}</td><td><select className={"status-select status-" + c.review_status} aria-label={"Review status for " + c.name} value={c.review_status} onChange={e => void setReviewStatus(c.id, e.target.value)}><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="contacted">Contacted</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select></td><td><button className="row-delete" title="Delete business" onClick={() => void deleteBusiness(c)}>✕</button></td></tr>)}</tbody></table></div>}
          <div className="table-footer"><span>Showing <strong>{formatCount(total ? (page - 1) * PAGE_SIZE + 1 : 0)}–{formatCount(Math.min(page * PAGE_SIZE, total))}</strong> of <strong>{formatCount(total)}</strong> businesses</span><div className="pagination"><button disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>← Previous</button><span>Page {page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>Next →</button></div></div>
        </section>
        </div>
        <footer className="app-footer"><span>© {new Date().getFullYear()} RumiReach · RumiTech Solutions</span><span>Built for better business connections.</span></footer>
        <span className="sr-only">{formatCount(stats.withWebsite)} records include a website.</span>
      </div>
    </main>
    <Toasts message={message} error={error} onClearMessage={() => setMessage("")} onClearError={() => setError("")}/>
    <ConfirmHost/>
  </div>;
}
