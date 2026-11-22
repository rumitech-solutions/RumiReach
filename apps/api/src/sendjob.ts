/** Sequential WhatsApp send queue: one message at a time, with a human-like pause between sends. Pure logic; I/O is injected so it can be tested. */
export type ItemStatus = "queued" | "sending" | "sent" | "failed" | "skipped";
export type JobItem = { id: string; name: string; status: ItemStatus; note?: string };
export type SendJob = {
  id: string; state: "running" | "done" | "cancelled"; total: number; sent: number; failed: number; skipped: number;
  items: JobItem[]; startedAt: string; finishedAt?: string; nextSendInSeconds: number;
};
export type Outcome = { status: "sent" | "failed" | "skipped"; note?: string; stop?: boolean };

export function personalize(template: string, name: string | null, category: string | null): string {
  return template.replace(/\\n/g, "\n").replace(/\{business_name\}/gi, name || "there").replace(/\{category\}/gi, category || "your business").trim();
}

/** The pause between messages: the chosen gap, optionally stretched by up to `jitter` (0.25 = 25%) so sends are not on a rigid clock. */
export function sendDelayMs(gapSeconds: number, random = Math.random(), jitter = 0.5): number {
  return Math.round(gapSeconds * 1000 * (1 + jitter * random));
}

export function createJob(id: string, items: Array<{ id: string; name: string }>): SendJob {
  return { id, state: "running", total: items.length, sent: 0, failed: 0, skipped: 0, startedAt: new Date().toISOString(), nextSendInSeconds: 0,
    items: items.map(item => ({ id: item.id, name: item.name, status: "queued" as ItemStatus })) };
}

export async function runJob(job: SendJob, send: (item: JobItem) => Promise<Outcome>,
  opts: { gapMs: () => number; sleep: (ms: number) => Promise<void>; cancelled: () => boolean }): Promise<void> {
  const settle = (item: JobItem, status: ItemStatus, note?: string) => {
    item.status = status; item.note = note;
    if (status === "sent") job.sent++; else if (status === "failed") job.failed++; else if (status === "skipped") job.skipped++;
  };
  for (let index = 0; index < job.items.length; index++) {
    if (opts.cancelled()) { job.state = "cancelled"; break; }
    const item = job.items[index];
    item.status = "sending";
    let outcome: Outcome;
    try { outcome = await send(item); } catch (error) { outcome = { status: "failed", note: error instanceof Error ? error.message : "Unexpected error." }; }
    settle(item, outcome.status, outcome.note);
    if (outcome.stop) {
      for (const rest of job.items.slice(index + 1)) settle(rest, "skipped", outcome.note);
      break;
    }
    const hasMore = index < job.items.length - 1;
    if (hasMore && outcome.status !== "skipped") {
      let remaining = opts.gapMs();
      while (remaining > 0 && !opts.cancelled()) {
        job.nextSendInSeconds = Math.ceil(remaining / 1000);
        const step = Math.min(1000, remaining);
        await opts.sleep(step); remaining -= step;
      }
      job.nextSendInSeconds = 0;
    }
  }
  if (job.state === "cancelled") for (const item of job.items) if (item.status === "queued") settle(item, "skipped", "Cancelled");
  if (job.state === "running") job.state = "done";
  job.finishedAt = new Date().toISOString(); job.nextSendInSeconds = 0;
}
