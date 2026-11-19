import { useEffect, useRef, useState } from "react";

type Service = { docker: boolean; container: "missing" | "running" | "stopped"; starting: boolean; error: string; session: string };

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

  let line = "Checking…";
  if (service) {
    if (!service.docker) line = "Docker is not running. Install and open Docker Desktop, then try again.";
    else if (service.starting) line = "Starting WhatsApp service… the first time it downloads the image (can take a few minutes).";
    else if (service.container === "missing") line = "WhatsApp service is not set up yet.";
    else if (service.container === "stopped") line = "WhatsApp service is stopped.";
    else if (service.session === "WORKING") line = "WhatsApp is connected and ready.";
    else if (service.session === "SCAN_QR_CODE") line = "Scan this QR code: WhatsApp → Linked devices → Link a device.";
    else line = "Service is running; preparing the WhatsApp session… (" + (service.session || "starting") + ")";
  }
  const canStart = !!service?.docker && !service.starting && service.container !== "running";

  return <div className="wa-service">
    <strong>One-click WhatsApp service</strong>
    <div className={"waha-status" + (service?.session === "WORKING" ? " connected" : "")}><span>{service?.session === "WORKING" ? "●" : "○"}</span> {line}</div>
    {(error || service?.error) && <div className="inline-error">{error || service?.error}</div>}
    {qr && <img className="wa-qr" src={qr} alt="WhatsApp pairing QR code"/>}
    <div className="wa-actions">
      <button className="secondary-button" disabled={!canStart} onClick={() => void act("/api/whatsapp/service/start")}>▶ Start WhatsApp service</button>
      {service?.container === "running" && <button className="secondary-button" onClick={() => void act("/api/whatsapp/service/stop")}>■ Stop</button>}
    </div>
    <small>Runs the official WAHA image through Docker on this computer only (127.0.0.1) with a private key stored locally. Pairing uses an unofficial WhatsApp Web link, so account restrictions remain possible.</small>
  </div>;
}
