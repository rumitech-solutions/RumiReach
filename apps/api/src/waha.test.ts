import test from "node:test";
import assert from "node:assert/strict";
import { buildRunArgs } from "./waha";

test("docker run publishes on localhost only and disables public dashboards", () => {
  const args = buildRunArgs("k".repeat(8), "/data/waha-sessions", "devlikeapro/waha", "");
  assert.ok(args.includes("127.0.0.1:3000:3000"));
  assert.ok(args.includes("WAHA_API_KEY=kkkkkkkk"));
  assert.ok(args.includes("WAHA_DASHBOARD_ENABLED=False"));
  assert.equal(args.at(-1), "devlikeapro/waha");
  assert.ok(!args.some(arg => arg.startsWith("WHATSAPP_DEFAULT_ENGINE")));
  assert.ok(buildRunArgs("k", "/s", "img", "NOWEB").includes("WHATSAPP_DEFAULT_ENGINE=NOWEB"));
  assert.ok(buildRunArgs("k", "/s", "img", "WEBJS").includes("WHATSAPP_DEFAULT_ENGINE=WEBJS"));
  assert.ok(args.includes("--shm-size"));
});
