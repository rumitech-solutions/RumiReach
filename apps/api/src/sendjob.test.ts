import test from "node:test";
import assert from "node:assert/strict";
import { createJob, personalize, runJob, sendDelayMs } from "./sendjob";

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: "c" + i, name: "Biz " + i }));
const fast = { gapMs: () => 2000, sleep: async () => undefined };

test("personalize fills placeholders and turns literal \\n into line breaks", () => {
  assert.equal(personalize("Hi {business_name} ({category})\\nBye", "Cafe", null), "Hi Cafe (your business)\nBye");
  assert.equal(personalize("Hello {BUSINESS_NAME}", null, "x"), "Hello there");
});

test("delay is between the gap and 1.5x the gap", () => {
  assert.equal(sendDelayMs(20, 0), 20000);
  assert.equal(sendDelayMs(20, 1), 30000);
});

test("sends sequentially, counts outcomes and only pauses after real attempts", async () => {
  const job = createJob("j", items(4)); const sleeps: number[] = [];
  const results = ["sent", "skipped", "failed", "sent"] as const;
  await runJob(job, async item => ({ status: results[Number(item.id.slice(1))], note: "n" }), { ...fast, sleep: async ms => { sleeps.push(ms); }, cancelled: () => false });
  assert.deepEqual([job.sent, job.failed, job.skipped, job.state], [2, 1, 1, "done"]);
  assert.equal(sleeps.length, 4); // 2s gap after item 0 and item 2 => 2 sleeps of 1s each
});

test("a stop outcome skips everything after it", async () => {
  const job = createJob("j", items(3));
  await runJob(job, async item => item.id === "c0" ? { status: "sent" } : { status: "failed", note: "Daily limit reached", stop: true }, { ...fast, cancelled: () => false });
  assert.deepEqual([job.sent, job.failed, job.skipped], [1, 1, 1]);
});

test("cancel stops the queue and marks the rest skipped", async () => {
  const job = createJob("j", items(3)); let cancel = false;
  await runJob(job, async () => { cancel = true; return { status: "sent" }; }, { ...fast, cancelled: () => cancel });
  assert.equal(job.state, "cancelled"); assert.deepEqual([job.sent, job.skipped], [1, 2]);
});
