import { useEffect, useState } from "react";
import { confirmDialog } from "./ui";

type Collection = { id: string; name: string; type: "search" | "csv"; place: string; status: string; createdAt: string; count: number; accepted: number };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!response.ok) throw new Error((data as { error?: string } | null)?.error || "Request failed (HTTP " + response.status + ").");
  return data as T;
}

export default function Collections({ active, onOpen, onChanged }: { active: boolean; onOpen: (id: string) => void; onChanged: () => void }) {
  const [items, setItems] = useState<Collection[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");

  async function load() {
    try { setItems((await call<{ collections: Collection[] }>("/api/collections")).collections); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load collections."); }
  }
  useEffect(() => { if (active) void load(); }, [active]);

  async function rename(id: string) {
    try {
      await call("/api/collections/" + id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: draft }) });
      setEditing(""); await load(); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not rename."); }
  }
  async function remove(item: Collection) {
    if (!await confirmDialog({ title: "Delete “" + item.name + "”?", body: "This also deletes its " + item.count.toLocaleString() + " businesses. It cannot be undone.", confirmLabel: "Delete collection", danger: true })) return;
    try { await call("/api/collections/" + item.id, { method: "DELETE" }); await load(); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete."); }
  }

  async function merge(item: Collection, intoId: string) {
    const target = items.find(other => other.id === intoId);
    if (!target) return;
    if (!await confirmDialog({ title: "Merge into “" + target.name + "”?", body: "All " + item.count.toLocaleString() + " businesses from “" + item.name + "” move over and the empty “" + item.name + "” list is removed.", confirmLabel: "Merge" })) return;
    try { await call("/api/collections/" + item.id + "/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ into: intoId }) }); await load(); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not merge."); }
  }

  const shown = items.filter(item => item.name.toLowerCase().includes(filter.trim().toLowerCase()));
  return <section className="panel" id="collections">
    <div className="section-heading"><div><span className="section-kicker">SAVED SEARCHES & IMPORTS</span><h2>Collections</h2><p>Every search and CSV import is saved here under a name. Open one to see just its businesses, export it, rename it or delete it.</p></div><span className="format-badge">{items.length} SAVED</span></div>
    {error && <div className="inline-error">{error}</div>}
    {items.length > 3 && <div className="find-field" style={{ marginBottom: 12 }}><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter collections…"/></div>}
    {!shown.length ? <div className="empty-state"><div className="empty-art">❏</div><strong>{items.length ? "No matching collections" : "Nothing saved yet"}</strong><p>Run a search in Find leads or import a CSV and it will appear here.</p></div>
      : <div className="collection-list">{shown.map(item => <article key={item.id} className="collection-card">
        <div className="collection-main">
          <span className={"collection-type " + item.type}>{item.type === "search" ? "SEARCH" : "CSV"}</span>
          {editing === item.id
            ? <form className="collection-rename" onSubmit={event => { event.preventDefault(); void rename(item.id); }}><input autoFocus value={draft} maxLength={100} onChange={event => setDraft(event.target.value)}/><button className="secondary-button" type="submit">Save</button><button className="secondary-button" type="button" onClick={() => setEditing("")}>Cancel</button></form>
            : <strong>{item.name}</strong>}
          <small>{item.count.toLocaleString()} businesses · {item.accepted.toLocaleString()} accepted{item.type === "search" && item.place ? " · " + item.place : ""} · {new Date(item.createdAt).toLocaleString()}{item.status !== "completed" ? " · " + item.status : ""}</small>
        </div>
        <div className="collection-actions">
          <button className="primary-button" onClick={() => onOpen(item.id)}>Open</button>
          <a className="secondary-button" href={"/api/candidates/export?collection=" + item.id} download="rumireach-collection.csv">↓ Export</a>
          <button className="secondary-button" onClick={() => { setEditing(item.id); setDraft(item.name); }}>Rename</button>
          {items.length > 1 && <select className="merge-select" aria-label={"Merge " + item.name + " into another collection"} value="" onChange={event => void merge(item, event.target.value)}><option value="">Merge into…</option>{items.filter(other => other.id !== item.id).map(other => <option key={other.id} value={other.id}>{other.name}</option>)}</select>}
          <button className="secondary-button danger" onClick={() => void remove(item)}>Delete</button>
        </div>
      </article>)}</div>}
  </section>;
}
