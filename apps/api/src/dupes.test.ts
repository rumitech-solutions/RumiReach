import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicates } from "./dupes";

const row = (id: string, name: string, phone: string, address: string, status = "pending", at = "2026-01-0" + id) => ({ id, name, phone_raw: phone, address, review_status: status, observed_at: at });

test("matches the same phone in different formats and the same name+address", () => {
  const result = findDuplicates([
    row("1", "Rumi Dental", "+92 300 1234567", "Lahore"),
    row("2", "Rumi Dental Clinic", "0300-1234567", "Gulberg"),
    row("3", "Smile Cafe", "", "Main Road"),
    row("4", "SMILE  CAFE", "", "main road"),
    row("5", "Other", "021 111", "Karachi")
  ]);
  assert.equal(result.groups, 2);
  assert.deepEqual(result.remove.sort(), ["2", "4"]);
});

test("keeps an already reviewed record over an older pending one", () => {
  const result = findDuplicates([row("1", "A", "0300 1234567", "x", "pending"), row("2", "A", "03001234567", "y", "accepted")]);
  assert.deepEqual(result.remove, ["1"]);
});
