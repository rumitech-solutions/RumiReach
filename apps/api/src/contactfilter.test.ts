import test from "node:test";
import assert from "node:assert/strict";
import { contactFilterClauses } from "./contactfilter";

test("filters combine: has phone and no website", () => {
  assert.deepEqual(contactFilterClauses("phone,nowebsite"), ["COALESCE(phone_raw, '') != ''", "COALESCE(website_url, '') = ''"]);
});
test("empty or unknown tokens add nothing", () => {
  assert.deepEqual(contactFilterClauses(""), []);
  assert.deepEqual(contactFilterClauses(undefined), []);
  assert.deepEqual(contactFilterClauses("bogus,;DROP"), []);
});
