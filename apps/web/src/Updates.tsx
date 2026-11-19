import { useState } from "react";

type Item = { id: string; name: string; installed: string | null; latest: string | null; url: string | null; status: "update" | "current" | "unknown"; command: string };

export default function Updates() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  async function check() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/updates");
      if (!response.ok) throw new Error("Update check failed (HTTP " + response.status + ").");
      setItems((await response.json() as { items: Item[] }).items);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Update check failed."); }
    finally { setBusy(false); }
  }

  async function copy(item: Item) {
    try { await navigator.clipboard.writeText(item.command); setCopied(item.id); setTimeout(() => setCopied(""), 2000); } catch { /* clipboard unavailable */ }
  }

  const label = (item: Item) => item.status === "update" ? "Update available" : item.status === "current" ? "Up to date" : item.latest ? "Latest: " + item.latest : "Could not check";
  return <section className="panel updates-panel">
    <div className="section-heading"><div><span className="section-kicker">MAINTENANCE</span><h2>Updates</h2><p>Check whether newer versions of the Google Maps scraper and WhatsApp service (WAHA) exist. Nothing updates by itself; this only looks, when you click.</p></div><button className="secondary-button" disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : "Check for updates"}</button></div>
    {error && <div className="inline-error">{error}</div>}
    {items && <div className="update-list">{items.map(item => <div key={item.id} className={"update-row u-" + item.status}>
      <div><strong>{item.name}</strong><small>Installed: {item.installed ? item.installed.slice(0, 40) : "unknown"} · Latest: {item.latest || "unknown"}</small></div>
      <span className="find-badge">{label(item)}</span>
      {item.status === "update" && <div className="update-how"><code>{item.command}</code><button className="secondary-button" onClick={() => void copy(item)}>{copied === item.id ? "Copied" : "Copy command"}</button>{item.url && <a className="secondary-button" href={item.url} target="_blank" rel="noreferrer">What’s new ↗</a>}</div>}
    </div>)}</div>}
  </section>;
}
