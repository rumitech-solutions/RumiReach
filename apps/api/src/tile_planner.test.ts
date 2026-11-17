import test from "node:test";
import assert from "node:assert/strict";
import {planDiscoveryTiles,MAX_DISCOVERY_TILES} from "./tile_planner";

test("splits a city boundary into non-overlapping bounded tiles",()=>{
 const tiles=planDiscoveryTiles({south:24.8,west:67.0,north:24.9,east:67.1});
 assert.equal(tiles.length,4);
 assert.deepEqual(tiles[0],{tileIndex:0,south:24.8,west:67,north:24.85,east:67.05});
 assert.ok(tiles.every(t=>(t.north-t.south)<=0.05+1e-10 && (t.east-t.west)<=0.05+1e-10));
});
test("covers remainder strips at the northern and eastern edges",()=>{
 const tiles=planDiscoveryTiles({south:0,west:0,north:0.12,east:0.11});
 assert.equal(tiles.length,9);
 assert.equal(tiles[8].north,0.12);
 assert.equal(tiles[8].east,0.11);
});
test("rejects invalid and excessively large boundaries",()=>{
 assert.throws(()=>planDiscoveryTiles({south:2,west:2,north:1,east:3}),/Invalid/);
 assert.throws(()=>planDiscoveryTiles({south:-10,west:-10,north:10,east:10}),new RegExp(String(MAX_DISCOVERY_TILES)));
});
