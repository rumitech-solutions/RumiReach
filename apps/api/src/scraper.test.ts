import test from "node:test";
import assert from "node:assert/strict";
import { buildQueries, firstEmail } from "./scraper";

test("builds keyword × city queries with state and country", () => {
  assert.deepEqual(
    buildQueries({ keywords: ["dentist", "clinic"], countryName: "Pakistan", stateName: "Punjab", cities: ["Lahore", "Multan"] }),
    ["dentist in Lahore, Punjab, Pakistan", "dentist in Multan, Punjab, Pakistan", "clinic in Lahore, Punjab, Pakistan", "clinic in Multan, Punjab, Pakistan"]
  );
});

test("falls back to state or country level and sanitizes input", () => {
  assert.deepEqual(buildQueries({ keywords: ["cafe\nin hell", "cafe  in hell"], countryName: "Pakistan", stateName: "Sindh", cities: [] }), ["cafe in hell in Sindh, Pakistan"]);
  assert.deepEqual(buildQueries({ keywords: ["gym"], countryName: "Pakistan", cities: [] }), ["gym in Pakistan"]);
});

test("extracts the first valid email from scraper output", () => {
  assert.equal(firstEmail('["info@rumi.pk", "sales@rumi.pk"]'), "info@rumi.pk");
  assert.equal(firstEmail("n/a; hello@example.com"), "hello@example.com");
  assert.equal(firstEmail(""), "");
});
