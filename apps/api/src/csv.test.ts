import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSourceUrl, normalizeWebsite, parseCsv } from "./csv";

test("parses quoted commas, escaped quotes, and CRLF rows",()=>{
 const rows=parseCsv('name,category,address\r\n"Rumi Cafe","restaurant","Main road, Block 2"\r\n"Quote ""House""",cafe,Karachi\r\n');
 assert.equal(rows.length,2);assert.equal(rows[0].name,"Rumi Cafe");assert.equal(rows[0].address,"Main road, Block 2");assert.equal(rows[1].name,'Quote "House"');
});

test("accepts name and business_name headers and rejects malformed CSV",()=>{
 assert.equal(parseCsv("business_name,phone\nCafe,123")[0].business_name,"Cafe");
 assert.throws(()=>parseCsv("business,phone\nCafe,123"),/name/);
 assert.throws(()=>parseCsv('name\n"Unclosed'),/unclosed/);
 assert.throws(()=>parseCsv("name,name\nCafe,Cafe"),/duplicate/);
});

test("normalizes website URLs and falls back for unsafe source URLs",()=>{
 assert.equal(normalizeWebsite("example.pk"),"https://example.pk/");
 assert.equal(normalizeWebsite("javascript:alert(1)"),null);
 assert.equal(normalizeSourceUrl("javascript:alert(1)","csv-import://file.csv#row=2"),"csv-import://file.csv#row=2");
});
