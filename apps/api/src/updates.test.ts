import test from "node:test";
import assert from "node:assert/strict";
import { parseVersion, updateStatus } from "./updates";

test("parses versions out of messy strings", () => {
  assert.deepEqual(parseVersion("v1.12.1"), [1, 12, 1]);
  assert.deepEqual(parseVersion("WAHA 2026.6.1 PLUS"), [2026, 6, 1]);
  assert.equal(parseVersion("dev"), null);
});

test("compares installed and latest versions", () => {
  assert.equal(updateStatus("1.12.0", "v1.12.1"), "update");
  assert.equal(updateStatus("v1.12.1", "1.12.1"), "current");
  assert.equal(updateStatus("2026.10", "2026.6.1"), "current");
  assert.equal(updateStatus(null, "1.0.0"), "unknown");
  assert.equal(updateStatus("1.0.0", null), "unknown");
});
