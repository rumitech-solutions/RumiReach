import { useEffect, useRef, useState } from "react";

type Service = { external: boolean; docker: boolean; container: "missing" | "running" | "stopped"; starting: boolean; error: string; session: string; startingSeconds?: number; stuck?: boolean; autoRecovering?: boolean };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!response.ok) throw new Error((data as { error?: string } | null)?.error || "Request failed (HTTP " + response.status + ").");
  return data as T;
}

/** One-click WhatsApp (WAHA) setup: start the Docker container, show the pairing QR, report when connected. */
export default function WhatsAppService({ active, onConnectedChange }: { active: boolean; onConnectedChange: () => void }) {
  const [service, setService] = useState<Service | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const lastSession = useRef("");

  async function refresh() {
    try {
      const next = await call<Service>("/api/whatsapp/service");
      setService(next); setError("");
      if (next.container === "running" && next.session === "NOT_FOUND") await call("/api/whatsapp/session/start", { method: "POST" }).catch(() => undefined);
      if (next.session === "SCAN_QR_CODE") { try { setQr((await call<{ image: string }>("/api/whatsapp/qr")).image); } catch { /* QR not ready yet */ } } else setQr("");
      if (next.session !== lastSession.current) { lastSession.current = next.session; onConnectedChange(); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not check the WhatsApp service."); }
  }

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [active]);

  async function act(path: string) {
    setError("");
    try { await call(path, { method: "POST" }); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Action failed."); }
  }

  const [busy, setBusy] = useState(false);
  async function resetSession() {
    setBusy(true); setError(""); setQr("");
    try { await call("/api/whatsapp/session/reset", { method: "POST" }); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reset the session."); }
    finally { setBusy(false); }
  }

  let line = "Checking…";
  if (service) {
    if (!service.docker) line = "Docker is not running. Install and open Docker Desktop, then try again.";
    else if (service.starting) line = "Starting WhatsApp service… the first time it downloads the image (can take a few minutes).";
    else if (service.container === "missing") line = "WhatsApp service is not set up yet.";
    else if (service.container === "stopped") line = "WhatsApp service is stopped.";
    else if (service.session === "WORKING") line = "WhatsApp is connected and ready.";
    else if (service.session === "SCAN_QR_CODE") line = "Scan this QR code: WhatsApp → Linked devices → Link a device.";
    else if (service.autoRecovering) line = "The session was stuck, so it is being rebuilt automatically… a fresh QR code will appear shortly.";
    else if (service.stuck) line = "The session is taking too long to start (" + service.startingSeconds + "s). Press “Reset session” to rebuild it.";
    else if (service.session === "STARTING") line = "Preparing the WhatsApp session… " + (service.startingSeconds ? service.startingSeconds + "s" : "just a moment");
    else if (service.session === "FAILED") line = "The WhatsApp session failed. Press “Reset session” to rebuild it.";
    else line = "Service is running; preparing the WhatsApp session… (" + (service.session || "starting") + ")";
  }
  const step = !service ? 0 : service.session === "WORKING" ? 4 : service.session === "SCAN_QR_CODE" ? 3 : service.container === "running" ? 2 : 1;
  const steps = ["Service", "Session", "Scan QR", "Connected"];
  const needsReset = service?.container === "running" && (service.stuck || service.session === "FAILED" || service.session === "STARTING");
  const canStart = !service?.external && !!service?.docker && !service.starting && service.container !== "running";

  return <div className="wa-service">
    <strong>One-click WhatsApp service</strong>
    <ol className="wa-steps" aria-label="Setup progress">{steps.map((label, index) => <li key={label} className={index + 1 < step ? "done" : index + 1 === step ? "current" : ""}><i>{index + 1 < step || step === 4 ? "✓" : index + 1}</i>{label}</li>)}</ol>
    <div className={"waha-status" + (service?.session === "WORKING" ? " connected" : service?.stuck ? " warn" : "")} role="status"><span className={service?.session === "STARTING" && !service.stuck ? "wa-pulse" : ""}>{service?.session === "WORKING" ? "●" : "○"}</span> {line}</div>
    {(error || service?.error) && <div className="inline-error">{error || service?.error}</div>}
    {qr && <img className="wa-qr" src={qr} alt="WhatsApp pairing QR code"/>}
    <div className="wa-actions">
      <button className="secondary-button" disabled={!canStart} onClick={() => void act("/api/whatsapp/service/start")}>▶ Start WhatsApp service</button>
      {needsReset && <button className={"secondary-button" + (service?.stuck ? " attention" : "")} disabled={busy} onClick={() => void resetSession()}>{busy ? "Resetting…" : "↻ Reset session"}</button>}
      {service?.container === "running" && !service.external && <button className="secondary-button" onClick={() => void act("/api/whatsapp/service/stop")}>■ Stop</button>}
    </div>
    <small>{service?.external ? "WhatsApp (WAHA) is managed by Docker Compose alongside RumiReach. " : ""}Runs the official WAHA image through Docker on this computer only (127.0.0.1) with a private key stored locally. Pairing uses an unofficial WhatsApp Web link, so account restrictions remain possible.</small>
  </div>;
}
