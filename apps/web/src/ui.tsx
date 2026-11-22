import { useEffect, useRef, useState } from "react";

/* ---------- In-app confirm dialog (replaces window.confirm) ---------- */
type ConfirmRequest = { title: string; body?: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void };
let pushConfirm: ((request: ConfirmRequest) => void) | null = null;

export function confirmDialog(options: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise(resolve => {
    if (!pushConfirm) { resolve(window.confirm(options.title + (options.body ? "\n\n" + options.body : ""))); return; }
    pushConfirm({ ...options, resolve });
  });
}

export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { pushConfirm = setRequest; return () => { pushConfirm = null; }; }, []);
  useEffect(() => { if (request) confirmButton.current?.focus(); }, [request]);
  if (!request) return null;
  const close = (ok: boolean) => { request.resolve(ok); setRequest(null); };
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(false); }} onKeyDown={event => { if (event.key === "Escape") close(false); }}>
    <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
      <h2 id="dialog-title">{request.title}</h2>
      {request.body && <p>{request.body}</p>}
      <div className="dialog-actions">
        <button className="secondary-button" onClick={() => close(false)}>Cancel</button>
        <button ref={confirmButton} className={request.danger ? "danger-button" : "primary-button"} onClick={() => close(true)}>{request.confirmLabel || "Confirm"}</button>
      </div>
    </div>
  </div>;
}

/* ---------- Toasts: success and error feedback that is visible on every page ---------- */
export function Toasts({ message, error, onClearMessage, onClearError }: { message: string; error: string; onClearMessage: () => void; onClearError: () => void }) {
  useEffect(() => { if (!message) return; const timer = setTimeout(onClearMessage, 6000); return () => clearTimeout(timer); }, [message]);
  useEffect(() => { if (!error) return; const timer = setTimeout(onClearError, 12000); return () => clearTimeout(timer); }, [error]);
  return <div className="toasts" aria-live="polite">
    {message && <div className="toast ok" role="status"><span className="toast-icon">✓</span><p>{message}</p><button aria-label="Dismiss message" onClick={onClearMessage}>✕</button></div>}
    {error && <div className="toast bad" role="alert"><span className="toast-icon">!</span><p>{error}</p><button aria-label="Dismiss error" onClick={onClearError}>✕</button></div>}
  </div>;
}
