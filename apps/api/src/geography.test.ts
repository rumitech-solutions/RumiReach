import {test} from "node:test";
import assert from "node:assert/strict";
import {parseCityResults} from "./geography";

test("parses Nominatim Pakistan place bounding boxes",()=>{
  const result=parseCityResults([{place_id:1,osm_type:"relation",osm_id:123,display_name:"Sargodha, Punjab, Pakistan",addresstype:"city",boundingbox:["31.9","32.2","72.5","72.8"]}]);
  assert.equal(result.length,1);
  assert.deepEqual(result[0].bbox,{south:31.9,west:72.5,north:32.2,east:72.8});
  assert.equal(result[0].id,"relation/123");
});
test("rejects malformed and excessively large city bounds",()=>{
  const result=parseCityResults([
    {place_id:1,osm_type:"node",osm_id:1,display_name:"bad",boundingbox:["x","2","3","4"]},
    {place_id:2,osm_type:"relation",osm_id:2,display_name:"too large",boundingbox:["-80","80","-170","170"]}
  ]);
  assert.equal(result.length,0);
});
