import test from "node:test";
import assert from "node:assert/strict";
import { buildOverpassQuery } from "./overpass";

const bbox={south:32.0,west:72.5,north:32.1,east:72.6};
test("builds a bounded restaurant query",()=>{
 const q=buildOverpassQuery("restaurant",bbox);
 assert.match(q,/amenity=restaurant/);
 assert.match(q,/32,72.5,32.1,72.6/);
 assert.match(q,/out tags center/);
});
test("supports broad business and common category filters",()=>{
 for(const category of ["all","cafe","shop","clinic","pharmacy","school","hotel","salon","gym","real_estate","lawyer","fuel"]){
  assert.match(buildOverpassQuery(category,bbox),/\[out:json\]/);
 }
});
test("rejects unsupported categories instead of issuing an empty query",()=>{
 assert.throws(()=>buildOverpassQuery("not-a-category",bbox),/Unsupported business category/);
});
