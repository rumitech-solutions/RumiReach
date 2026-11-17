import { test } from "node:test";
import assert from "node:assert/strict";
import { compareBusinessRecords, normalizePakistaniPhone, normalizeWebsiteDomain, nameSimilarity } from "./matching";

const base = { id:"a", name:"Rumi Cafe", category:"restaurant", address:"Gulshan-e-Iqbal, Karachi", phone_raw:"03001234567", website_url:"https://rumicafe.pk", public_email:null };
test("normalizes common Pakistani phone formats",()=>{
  assert.equal(normalizePakistaniPhone("0300-1234567"),"03001234567");
  assert.equal(normalizePakistaniPhone("+92 300 1234567"),"03001234567");
  assert.equal(normalizePakistaniPhone("0092-300-1234567"),"03001234567");
  assert.equal(normalizePakistaniPhone("123"),null);
});
test("normalizes website host and ignores social profile domains",()=>{
  assert.equal(normalizeWebsiteDomain("https://www.RumiCafe.pk/menu"),"rumicafe.pk");
  assert.equal(normalizeWebsiteDomain("https://facebook.com/rumicafe"),null);
});
test("auto-matches exact phone plus compatible name",()=>{
  const result=compareBusinessRecords(base,{...base,id:"b",name:"Rumi Cafe Pvt Ltd",phone_raw:"+92 300 1234567",website_url:null});
  assert.equal(result.matched,true); assert.equal(result.confidence,0.99);
});
test("does not merge similar names without strong identity evidence",()=>{
  const result=compareBusinessRecords(base,{...base,id:"b",name:"Rumi Cafe Gulshan",phone_raw:null,website_url:null});
  assert.equal(result.matched,false);
});
test("does not merge separate branches with conflicting addresses",()=>{
  const result=compareBusinessRecords(base,{...base,id:"b",address:"DHA Phase 6, Karachi"});
  assert.equal(result.matched,false); assert.ok(result.reasons.includes("address_or_branch_conflict"));
});
test("website domain match requires strong name similarity",()=>{
  assert.equal(compareBusinessRecords(base,{...base,id:"b",name:"Rumi Cafe",phone_raw:null}).matched,true);
  assert.equal(nameSimilarity("Rumi Cafe","Rumi Coffee"),0.3333333333333333);
});
