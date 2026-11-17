import { useEffect, useMemo, useRef, useState } from "react";

type Candidate = { id: string; name: string | null; category: string | null; address: string | null; phone_raw: string | null; website_url: string | null; public_email: string | null; source_url: string; observed_at: string; review_status: string };
type DirectoryResponse = { items: Candidate[]; total: number; page: number; pageSize: number; totalPages: number; categories: string[]; stats: { total: number; accepted: number; pending: number; withPhone: number; withWebsite: number } };
type CsvRow = Record<string, string>;
const PAGE_SIZE = 25;
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
      if (!headers.includes("name") && !headers.includes("business_name")) throw new Error('CSV must include a "name" or "business_name" column.');
    } else {
      batch.push(Object.fromEntries(headers.map((header, index) => [header, (row[index] ?? "").trim()])));
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
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { localStorage.setItem("rumireach.whatsappDraft", whatsappDraft); }, [whatsappDraft]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), search: query, sort });
    if (category !== "all") params.set("category", category);
    if (review !== "all") params.set("status", review);
    fetch("/api/candidates?" + params.toString(), { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Could not load saved records."); return response.json() as Promise<DirectoryResponse>; })
      .then(data => { setCandidates(data.items); setTotal(data.total); setTotalPages(Math.max(1, data.totalPages)); setCategories(data.categories); setStats(data.stats); setError(""); })
      .catch(reason => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Could not load records."); });
    return () => controller.abort();
  }, [page, query, category, review, sort]);

  async function refresh() {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), search: query, sort });
    if (category !== "all") params.set("category", category);
    if (review !== "all") params.set("status", review);
    const response = await fetch("/api/candidates?" + params.toString());
    if (!response.ok) throw new Error("Could not load saved records.");
    const data = await response.json() as DirectoryResponse;
    setCandidates(data.items); setTotal(data.total); setTotalPages(Math.max(1, data.totalPages)); setCategories(data.categories); setStats(data.stats);
  }

  async function importCsv() {
    if (!csvFile) return;
    setCsvBusy(true); setError(""); setMessage(""); setProgress("Preparing import…");
    let batchId = "";
    try {
      const started = await fetch("/api/import/csv/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: csvFile.name }) });
      const session = await started.json();
      if (!started.ok) throw new Error(session.error || "Could not start import.");
      batchId = session.batchId;
      let rowsSent = 0;
      await streamCsvFile(csvFile, async (rows, startRow) => {
        const response = await fetch("/api/import/csv/" + batchId + "/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows, startRow }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "A CSV batch could not be saved.");
        rowsSent += rows.length;
        setProgress(formatCount(rowsSent) + " rows processed…");
      });
      const completed = await fetch("/api/import/csv/" + batchId + "/complete", { method: "POST" });
      const result = await completed.json();
      if (!completed.ok) throw new Error(result.error || "Could not complete import.");
      setMessage("Imported " + formatCount(result.imported) + " businesses. " + formatCount(result.skipped) + " blank-name rows skipped; " + formatCount(result.invalidWebsite) + " invalid website values ignored.");
      setCsvFile(null); setPage(1);
      if (fileInput.current) fileInput.current.value = "";
      setProgress(""); await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "CSV import failed.");
      setProgress("Import stopped. Already saved batches remain in the database.");
    } finally { setCsvBusy(false); }
  }

  async function setReviewStatus(id: string, status: string) {
    const response = await fetch("/api/candidates/" + id + "/review", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) { setError("Could not update review status."); return; }
    setCandidates(rows => rows.map(item => item.id === id ? { ...item, review_status: status } : item));
    void refresh().catch(reason => setError(reason.message));
  }

  function openWhatsApp(candidate: Candidate) {
    const phone = whatsappNumber(candidate.phone_raw || "");
    if (!phone) { setError("This business does not have a usable phone number."); return; }
    const text = makeWhatsAppMessage(whatsappDraft, candidate);
    const url = "https://wa.me/" + phone + "?text=" + encodeURIComponent(text);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function chooseFile(file?: File) { if (file && file.name.toLowerCase().endsWith(".csv")) { setCsvFile(file); setMessage(""); setError(""); setProgress(""); } }
  const pageRows = useMemo(() => candidates, [candidates]);
  function exportCsv() {
    const params = new URLSearchParams({ search: query, sort });
    if (category !== "all") params.set("category", category);
    if (review !== "all") params.set("status", review);
    const anchor = document.createElement("a");
    anchor.href = "/api/candidates/export?" + params.toString();
    anchor.download = "rumireach-leads.csv";
    anchor.click();
  }

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">R</span><span><strong>RumiReach</strong><small>BY RUMITECH</small></span></div>
      <div className="workspace-label">WORKSPACE</div><nav><a className="nav-item active" href="#overview"><span className="nav-icon">⌂</span>Overview</a><a className="nav-item" href="#import"><span className="nav-icon">⇧</span>Import leads</a><a className="nav-item" href="#leads"><span className="nav-icon">▤</span>All businesses <span className="nav-count">{formatCount(stats.total)}</span></a></nav>
      <div className="sidebar-bottom"><div className="storage-card"><span className="storage-icon">◈</span><strong>Your data stays local</strong><p>Business records are stored in your local RumiReach workspace.</p><span className="storage-status"><i/> LOCAL DATABASE</span></div><div className="profile"><span className="avatar">R</span><span><strong>RumiTech Solutions</strong><small>Workspace owner</small></span><span className="profile-dots">···</span></div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>Overview</strong></div><div className="top-actions"><span className="secure-pill"><i/> Private workspace</span><button className="icon-button" title="Refresh records" onClick={() => void refresh().catch(e => setError(e.message))}>↻</button></div></header>
      <div className="content" id="overview"><section className="welcome-row"><div><div className="eyebrow"><span/> LEAD MANAGEMENT WORKSPACE</div><h1>Good work starts with <em>good leads.</em></h1><p>Bring your business data together. Import, organize, review and manage every opportunity in one place.</p></div><button className="primary-button" onClick={() => document.getElementById("import")?.scrollIntoView({ behavior: "smooth" })}><span>＋</span> Import leads</button></section>
        <section className="stats-grid"><article className="stat-card"><div className="stat-top"><span>Total businesses</span><span className="stat-icon teal">▤</span></div><strong>{formatCount(stats.total)}</strong><small>Records in your workspace</small></article><article className="stat-card"><div className="stat-top"><span>Accepted leads</span><span className="stat-icon green">✓</span></div><strong>{formatCount(stats.accepted)}</strong><small>Approved for follow-up</small></article><article className="stat-card"><div className="stat-top"><span>Pending review</span><span className="stat-icon amber">◷</span></div><strong>{formatCount(stats.pending)}</strong><small>Awaiting your decision</small></article><article className="stat-card"><div className="stat-top"><span>Have phone numbers</span><span className="stat-icon blue">⌕</span></div><strong>{formatCount(stats.withPhone)}</strong><small>{stats.total ? Math.round(stats.withPhone / stats.total * 100) : 0}% of all records</small></article></section>
        <section className="panel import-panel" id="import"><div className="section-heading"><div><span className="section-kicker">01 / DATA INTAKE</span><h2>Bring your leads in</h2><p>Upload a CSV and let RumiReach organize the details for you.</p></div><span className="format-badge">CSV FILE</span></div>
          <div className={"dropzone" + (dragging ? " drag-active" : "")} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0]); }} onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.current?.click(); } }}>
            <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={e => chooseFile(e.target.files?.[0])}/><div className="upload-symbol"><span>↑</span></div><strong>{csvFile ? csvFile.name : "Drop your CSV file here"}</strong><p>{csvFile ? "Ready to import · " + (csvFile.size / 1024 / 1024).toFixed(2) + " MB" : "or click to browse files on your computer"}</p><span className="browse-button">Choose a file</span>
          </div><div className="import-meta"><span><b>↳</b> Streaming file reader</span><span><b>✓</b> No fixed row or file-size cap</span><span><b>◈</b> Batched local database writes</span></div>
          <div className="import-actions">{message && <div className="inline-success">✓ {message}</div>}{error && <div className="inline-error">{error}</div>}{progress && <div className="import-progress">{progress}</div>}<div className="import-submit"><span className="selected-file">{csvFile ? "Selected and ready" : "CSV files · UTF-8 supported"}</span><button className="primary-button" disabled={!csvFile || csvBusy} onClick={() => void importCsv()}>{csvBusy ? "Importing…" : "Import dataset"} <span>→</span></button></div></div>
          <p className="helper-text">Required column: <code>name</code> or <code>business_name</code>. Optional: category, address, phone, website, email and source_url. Imported details are marked unverified until reviewed.</p>
        </section>
        <section className="panel leads-panel" id="leads"><div className="section-heading leads-heading"><div><span className="section-kicker">02 / YOUR DATABASE</span><h2>Business directory <span className="count-pill">{formatCount(total)}</span></h2><p>Search, browse and export your full filtered dataset without loading every record at once.</p></div><button className="secondary-button" disabled={!candidates.length} onClick={exportCsv}>↓ <span>Export CSV</span></button></div>
          <div className="whatsapp-composer">
            <div className="whatsapp-composer-heading"><div><span className="section-kicker">03 / PERSONAL OUTREACH</span><h3>WhatsApp message draft</h3><p>One editable message for your outreach. It is saved in this browser and personalized with each business name.</p></div><button className="draft-reset" onClick={() => setWhatsappDraft(DEFAULT_WHATSAPP_DRAFT)}>Reset template</button></div>
            <textarea aria-label="Editable WhatsApp message draft" value={whatsappDraft} onChange={e => setWhatsappDraft(e.target.value)} placeholder="Write your WhatsApp message…"/>
            <div className="draft-footer"><span>Use <code>{'{business_name}'}</code> and <code>{'{category}'}</code> to personalize each message.</span><span className="draft-saved"><i/> Saved in this browser</span></div>
          </div>
          <div className="filter-bar"><div className="search-box"><span>⌕</span><input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search businesses, phone, location…"/></div><select aria-label="Category filter" value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}><option value="all">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Review filter" value={review} onChange={e => { setReview(e.target.value); setPage(1); }}><option value="all">All statuses</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select><select aria-label="Sort records" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="newest">Recently added</option><option value="name">Business name</option><option value="category">Category</option></select></div>
          {!pageRows.length ? <div className="empty-state"><div className="empty-art">▤</div><strong>{stats.total ? "No matching businesses" : "Your directory starts here"}</strong><p>{stats.total ? "Try another search or adjust your filters." : "Import your first CSV dataset to see your business records appear here."}</p><button className="secondary-button" onClick={() => document.getElementById("import")?.scrollIntoView({ behavior: "smooth" })}>Import a CSV <span>→</span></button></div> : <div className="table-scroll"><table><thead><tr><th>BUSINESS</th><th>LOCATION</th><th>CONTACT</th><th>ONLINE PRESENCE</th><th>STATUS</th><th></th></tr></thead><tbody>{pageRows.map(c => <tr key={c.id}><td><div className="business-cell"><span className="business-avatar">{(c.name || "?").trim().charAt(0).toUpperCase()}</span><span><strong>{c.name || "Unnamed business"}</strong><small>{c.category || "Uncategorized"}</small></span></div></td><td><span className="address-cell">{c.address || "—"}</span></td><td><div className="contact-actions">{c.phone_raw ? <><a className="phone-link" href={"tel:" + c.phone_raw}>{c.phone_raw}</a><button className="whatsapp-button" onClick={() => openWhatsApp(c)} title={"Open WhatsApp draft for " + c.name}>◉ WhatsApp</button></> : <span className="no-phone">No phone number</span>}</div></td><td>{c.website_url ? <a className="website-link" href={c.website_url} target="_blank" rel="noreferrer">Visit website ↗</a> : c.public_email ? <a className="website-link" href={"mailto:" + c.public_email}>{c.public_email}</a> : "—"}{c.public_email && c.website_url && <small className="email-sub">{c.public_email}</small>}</td><td><select className={"status-select status-" + c.review_status} aria-label={"Review status for " + c.name} value={c.review_status} onChange={e => void setReviewStatus(c.id, e.target.value)}><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select></td><td><span className="row-menu" title={"Imported " + new Date(c.observed_at).toLocaleDateString()}>···</span></td></tr>)}</tbody></table></div>}
          <div className="table-footer"><span>Showing <strong>{formatCount(total ? (page - 1) * PAGE_SIZE + 1 : 0)}–{formatCount(Math.min(page * PAGE_SIZE, total))}</strong> of <strong>{formatCount(total)}</strong> businesses</span><div className="pagination"><button disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>← Previous</button><span>Page {page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>Next →</button></div></div>
        </section>
        <footer className="app-footer"><span>© {new Date().getFullYear()} RumiReach · RumiTech Solutions</span><span>Built for better business connections.</span></footer>
        <span className="sr-only">{formatCount(stats.withWebsite)} records include a website.</span>
      </div>
    </main>
  </div>;
}
