import test from "node:test";
import assert from "node:assert/strict";
import { findFieldConflicts } from "./provenance";

test("reports only fields with more than one distinct value", () => {
  const conflicts = findFieldConflicts([
    {field_name:"phone",field_value:"+923001112233"},
    {field_name:"phone",field_value:"+923001112233"},
    {field_name:"phone",field_value:"+923009998877"},
    {field_name:"website",field_value:"https://example.pk"}
  ]);
  assert.deepEqual(conflicts, [{field:"phone",values:["+923001112233","+923009998877"]}]);
});

test("ignores blank observations and does not invent conflicts", () => {
  assert.deepEqual(findFieldConflicts([
    {field_name:" ",field_value:"x"},
    {field_name:"email",field_value:""},
    {field_name:"name",field_value:"Cafe One"}
  ]), []);
});
