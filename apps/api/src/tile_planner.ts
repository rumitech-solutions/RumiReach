export type Bbox = { south:number; west:number; north:number; east:number };
export type DiscoveryTile = Bbox & { tileIndex:number };

export const MAX_TILE_SPAN_DEGREES = 0.05;
export const MAX_DISCOVERY_TILES = 500;

export function planDiscoveryTiles(bbox:Bbox, maxSpan=MAX_TILE_SPAN_DEGREES):DiscoveryTile[] {
  const values=[bbox.south,bbox.west,bbox.north,bbox.east,maxSpan];
  if(!values.every(Number.isFinite) || bbox.south < -90 || bbox.north > 90 || bbox.west < -180 || bbox.east > 180 || bbox.south>=bbox.north || bbox.west>=bbox.east || maxSpan<=0 || maxSpan>0.05) {
    throw new Error("Invalid search boundary or tile size.");
  }
  const rows=Math.max(1,Math.ceil((bbox.north-bbox.south-1e-10)/maxSpan));
  const columns=Math.max(1,Math.ceil((bbox.east-bbox.west-1e-10)/maxSpan));
  if(rows*columns>MAX_DISCOVERY_TILES) throw new Error("This boundary requires "+(rows*columns)+" tiles, above the safe limit of "+MAX_DISCOVERY_TILES+". Choose a smaller city/locality boundary.");
  const tiles:DiscoveryTile[]=[];
  for(let row=0;row<rows;row++){
    const south=bbox.south+row*maxSpan;
    const north=Math.min(bbox.north,south+maxSpan);
    for(let column=0;column<columns;column++){
      const west=bbox.west+column*maxSpan;
      const east=Math.min(bbox.east,west+maxSpan);
      tiles.push({tileIndex:tiles.length,south,west,north,east});
    }
  }
  return tiles;
}
