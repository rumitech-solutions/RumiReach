import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { SearchRequestSchema } from "@rumireach/shared";
import { db } from "./db";
import { discoverBusinesses } from "./overpass";
import { findFieldConflicts } from "./provenance";
import { normalizeSourceUrl, normalizeWebsite, parseCsv } from "./csv";
import { ensureMatchingSchema, resolveUnlinkedCandidates } from "./matching";
import { lookupPakistanCity } from "./geography";
import { planDiscoveryTiles } from "./tile_planner";

ensureMatchingSchema();

const app = Fastify({logger:true,bodyLimit:2_000_000});
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4317);
app.get("/api/health",async()=>({ok:true,app:"RumiReach",version:"0.1.0"}));
app.get("/api/sources",async()=>db.prepare("SELECT id,name,terms_url,attribution,enabled,reviewed_at FROM sources ORDER BY name").all());
app.get("/api/candidates",async(request)=>{
  const query=request.query as {jobId?:string};
  const sql="SELECT id,job_id,source_object_type,source_object_id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at,review_status FROM candidates ";
  return query.jobId ? db.prepare(sql+"WHERE job_id=? ORDER BY name COLLATE NOCASE").all(query.jobId) : db.prepare(sql+"ORDER BY observed_at DESC LIMIT 300").all();
});
app.get("/api/geography/lookup",async(request,reply)=>{
  const query=request.query as {city?:string};
  if(typeof query.city!=="string" || query.city.trim().length<2 || query.city.trim().length>80) return reply.code(400).send({error:"Provide a city name between 2 and 80 characters."});
  try {
    const results=await lookupPakistanCity(query.city);
    return {query:query.city,country:"Pakistan",results,attribution:"Geocoding data © OpenStreetMap contributors (ODbL). Public Nominatim use is user-triggered, cached, and rate-limited."};
  } catch(error) {
    const message=error instanceof Error?error.message:"City lookup failed.";
    return reply.code(message.includes("busy") || message.includes("rate-limiting")?429:502).send({error:message});
  }
});
app.post("/api/search",async(request,reply)=>{
 const parsed=SearchRequestSchema.safeParse(request.body);
 if(!parsed.success) return reply.code(400).send({error:"Invalid search request",details:parsed.error.flatten()});
 const input=parsed.data;
 let tiles;
 try { tiles=planDiscoveryTiles(input.bbox); } catch(error) { return reply.code(400).send({error:error instanceof Error?error.message:"Invalid city boundary"}); }
 const source=db.prepare("SELECT enabled FROM sources WHERE id='osm_overpass'").get() as {enabled:number}|undefined;
 if(!source?.enabled) return reply.code(403).send({error:"OSM source is disabled pending policy review."});
 const jobId=randomUUID(),createdAt=new Date().toISOString();
 const createJob=db.transaction(()=>{
  db.prepare("INSERT INTO search_jobs (id,category,city,locality,bbox_south,bbox_west,bbox_north,bbox_east,source_id,status,created_at,max_results) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(jobId,input.category,input.city,input.locality,input.bbox.south,input.bbox.west,input.bbox.north,input.bbox.east,"osm_overpass","queued",createdAt,input.maxResults);
  const insert=db.prepare("INSERT INTO discovery_tiles (id,job_id,tile_index,bbox_south,bbox_west,bbox_north,bbox_east,status) VALUES (?,?,?,?,?,?,?,?)");
  for(const tile of tiles) insert.run(randomUUID(),jobId,tile.tileIndex,tile.south,tile.west,tile.north,tile.east,"queued");
 });
 createJob();
 enqueueDiscoveryJob(jobId);
 return reply.code(202).send({jobId,status:"queued",totalTiles:tiles.length,maxResults:input.maxResults,attribution:"© OpenStreetMap contributors — data available under the Open Database License (ODbL)"});
});
app.post("/api/import/csv",async(request,reply)=>{
  const body=request.body as {filename?:string;csv?:string};
  if(typeof body?.csv!=="string" || !body.csv.trim()) return reply.code(400).send({error:"Provide CSV text in the csv field."});
  if(Buffer.byteLength(body.csv,"utf8")>1_500_000) return reply.code(413).send({error:"CSV exceeds the 1.5 MB import limit."});
  const filename=(body.filename||"business-import.csv").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,100) || "business-import.csv";
  let rows;
  try { rows=parseCsv(body.csv); } catch(error) { return reply.code(400).send({error:error instanceof Error?error.message:"Invalid CSV."}); }
  if(rows.length>5000) return reply.code(413).send({error:"CSV exceeds the 5,000 data-row limit."});
  const batchId=randomUUID(),jobId=randomUUID(),createdAt=new Date().toISOString();
  const sourceId="user_csv_import";
  const sourceUrlFor=(row:Record<string,string>,index:number)=>normalizeSourceUrl(row.source_url||"", "csv-import://"+encodeURIComponent(filename)+"#row="+(index+2));
  const insertCandidate=db.prepare("INSERT INTO candidates (id,job_id,source_id,source_object_type,source_object_id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertObservation=db.prepare("INSERT OR IGNORE INTO field_observations (id,candidate_id,source_id,field_name,field_value,source_url,observed_at,source_timestamp,verification_status,confidence) VALUES (?,?,?,?,?,?,?,?,?,NULL)");
  let imported=0,skipped=0,invalidWebsite=0;
  const run=db.transaction(()=>{
    db.prepare("INSERT OR IGNORE INTO sources (id,name,terms_url,attribution,enabled,reviewed_at) VALUES (?,?,?,?,?,?)").run(sourceId,"User-provided CSV","Operator-supplied data; review the original source terms before reuse.","User-provided data. Preserve any original source attribution.",1,createdAt);
    db.prepare("INSERT INTO search_jobs (id,category,city,locality,bbox_south,bbox_west,bbox_north,bbox_east,source_id,status,candidate_count,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(jobId,"mixed","CSV import",filename,0,0,0,0,sourceId,"running",0,createdAt,null);
    rows.forEach((row,index)=>{
      const name=(row.name||row.business_name||"").trim();
      if(!name){skipped++;return;}
      const category=(row.category||row.business_category||"").trim()||"unknown";
      const address=(row.address||"").trim();
      const phone=(row.phone||row.phone_number||"").trim();
      const websiteRaw=(row.website||row.website_url||"").trim();
      const website=normalizeWebsite(websiteRaw);
      if(websiteRaw&&!website) invalidWebsite++;
      const email=(row.email||row.public_email||"").trim();
      const sourceUrl=sourceUrlFor(row,index);
      const candidateId=randomUUID(),observedAt=new Date().toISOString();
      const values:Record<string,string|null>={name,category:(row.category||row.business_category||"").trim()||null,address:address||null,phone:phone||null,website,email:email||null};
      insertCandidate.run(candidateId,jobId,sourceId,"csv_row",batchId+":"+(index+2),name,category,address||null,phone||null,website,email||null,sourceUrl,observedAt,JSON.stringify({filename,rowNumber:index+2,values:row}));
      for(const [field,value] of Object.entries(values)) if(value) insertObservation.run(randomUUID(),candidateId,sourceId,field,value,sourceUrl,observedAt,null,"unverified");
      imported++;
    });
    db.prepare("UPDATE search_jobs SET status='completed',candidate_count=?,finished_at=? WHERE id=?").run(imported,new Date().toISOString(),jobId);
  });
  try { run(); } catch(error) { request.log.error(error,"CSV import failed"); return reply.code(500).send({error:"CSV import failed; no partial batch was committed."}); }
  const matching=resolveUnlinkedCandidates();
  return {batchId,jobId,sourceId,filename,status:"completed",imported,skipped,invalidWebsite,matching,limit:5000,notice:"Imported values are unverified. High-confidence identity matches are automatically grouped into unified business profiles; original source records and field observations are retained."};
});
app.get("/api/profiles",async()=>db.prepare(`SELECT p.id,p.canonical_name,p.category,p.address,p.phone_raw,p.website_url,p.public_email,p.created_at,p.updated_at,COUNT(s.candidate_id) AS source_count FROM business_profiles p LEFT JOIN business_profile_sources s ON s.profile_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 500`).all());
app.get("/api/matching/status",async()=>({profiles:(db.prepare("SELECT COUNT(*) AS count FROM business_profiles").get() as {count:number}).count,linkedRecords:(db.prepare("SELECT COUNT(*) AS count FROM business_profile_sources").get() as {count:number}).count,sourceRecords:(db.prepare("SELECT COUNT(*) AS count FROM candidates").get() as {count:number}).count,automaticMerges:(db.prepare("SELECT COUNT(*) AS count FROM merge_history").get() as {count:number}).count}));
app.get("/api/candidates/:id/provenance",async(request,reply)=>{
  const params=request.params as {id:string};
  const candidate=db.prepare("SELECT id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at FROM candidates WHERE id=?").get(params.id);
  if(!candidate) return reply.code(404).send({error:"Candidate not found."});
  const observations=db.prepare("SELECT id,field_name,field_value,source_id,source_url,observed_at,source_timestamp,verification_status,confidence FROM field_observations WHERE candidate_id=? ORDER BY field_name, observed_at DESC").all(params.id) as Array<{field_name:string;field_value:string}>;
  const conflicts=findFieldConflicts(observations);
  return {candidate,observations,conflicts};
});
app.patch("/api/candidates/:id/review",async(request,reply)=>{
  const params=request.params as {id:string},body=request.body as {status?:string};
  if(!["accepted","rejected","needs_review"].includes(body?.status||"")) return reply.code(400).send({error:"Invalid review status."});
  const result=db.prepare("UPDATE candidates SET review_status=? WHERE id=?").run(body.status,params.id);
  if(!result.changes) return reply.code(404).send({error:"Candidate not found."});
  return {ok:true};
});
const runningJobs=new Set<string>();
let discoveryQueue:Promise<void>=Promise.resolve();
function enqueueDiscoveryJob(jobId:string){discoveryQueue=discoveryQueue.then(()=>processDiscoveryJob(jobId)).catch(error=>app.log.error({jobId,error},"Queued discovery job failed"));}
async function processDiscoveryJob(jobId:string):Promise<void>{
 if(runningJobs.has(jobId)) return;
 runningJobs.add(jobId);
 try {
  const job=db.prepare("SELECT category,max_results,candidate_count,source_timestamp FROM search_jobs WHERE id=?").get(jobId) as {category:string;max_results:number;candidate_count:number;source_timestamp:string|null}|undefined;
  if(!job) return;
  db.prepare("UPDATE search_jobs SET status='running',error_message=NULL,finished_at=NULL WHERE id=?").run(jobId);
  const next=db.prepare("SELECT * FROM discovery_tiles WHERE job_id=? AND status='queued' ORDER BY tile_index");
  const updateTile=db.prepare("UPDATE discovery_tiles SET status=?,candidate_count=?,error_message=?,started_at=COALESCE(started_at,?),finished_at=? WHERE id=?");
  let total=job.candidate_count;
  let sourceTimestamp=job.source_timestamp;
  for(const tile of next.all(jobId) as Array<{id:string;bbox_south:number;bbox_west:number;bbox_north:number;bbox_east:number}>){
   if(total>=job.max_results) { updateTile.run("skipped",0,"Job result limit reached",null,new Date().toISOString(),tile.id); continue; }
   const startedAt=new Date().toISOString();
   updateTile.run("running",0,null,startedAt,null,tile.id);
   try {
    const result=await discoverBusinesses({jobId,bbox:{south:tile.bbox_south,west:tile.bbox_west,north:tile.bbox_north,east:tile.bbox_east},maxResults:job.max_results-total,category:job.category});
    total+=result.count;
    if(result.sourceTimestamp) sourceTimestamp=result.sourceTimestamp;
    updateTile.run("completed",result.count,null,startedAt,new Date().toISOString(),tile.id);
    db.prepare("UPDATE search_jobs SET candidate_count=?,source_timestamp=? WHERE id=?").run(total,sourceTimestamp,jobId);
   } catch(error) {
    const message=error instanceof Error?error.message:"Unknown tile error";
    updateTile.run("failed",0,message,startedAt,new Date().toISOString(),tile.id);
    db.prepare("UPDATE search_jobs SET status='failed',candidate_count=?,error_message=?,finished_at=? WHERE id=?").run(total,message,new Date().toISOString(),jobId);
    return;
   }
  }
  const remaining=(db.prepare("SELECT COUNT(*) AS count FROM discovery_tiles WHERE job_id=? AND status IN ('queued','failed','running')").get(jobId) as {count:number}).count;
  if(remaining===0){
   db.prepare("UPDATE search_jobs SET status='completed',candidate_count=?,finished_at=? WHERE id=?").run(total,new Date().toISOString(),jobId);
   resolveUnlinkedCandidates();
  } else {
   db.prepare("UPDATE search_jobs SET status='failed',candidate_count=?,error_message=?,finished_at=? WHERE id=?").run(total,"Some tiles remain incomplete. Resume the job to retry failed tiles.",new Date().toISOString(),jobId);
  }
 } finally { runningJobs.delete(jobId); }
}
function getJobProgress(jobId:string){
 const job=db.prepare("SELECT id,category,city,locality,status,candidate_count,max_results,error_message,source_timestamp,created_at,finished_at FROM search_jobs WHERE id=?").get(jobId);
 if(!job) return null;
 const counts=db.prepare("SELECT COUNT(*) AS totalTiles,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completedTiles,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failedTiles,SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queuedTiles,SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) AS skippedTiles FROM discovery_tiles WHERE job_id=?").get(jobId);
 return {...job,...counts,tiles:db.prepare("SELECT tile_index,status,candidate_count,error_message FROM discovery_tiles WHERE job_id=? ORDER BY tile_index").all(jobId)};
}
app.get("/api/jobs/:id",async(request,reply)=>{
 const {id}=request.params as {id:string};
 const progress=getJobProgress(id);
 return progress?progress:reply.code(404).send({error:"Job not found."});
});
app.post("/api/jobs/:id/resume",async(request,reply)=>{
 const {id}=request.params as {id:string};
 const job=db.prepare("SELECT status FROM search_jobs WHERE id=?").get(id) as {status:string}|undefined;
 if(!job) return reply.code(404).send({error:"Job not found."});
 if(runningJobs.has(id) || job.status==="running") return reply.code(409).send({error:"This job is already running."});
 const retry=db.prepare("UPDATE discovery_tiles SET status='queued',error_message=NULL,started_at=NULL,finished_at=NULL WHERE job_id=? AND status IN ('failed','running')").run(id);
 const queued=(db.prepare("SELECT COUNT(*) AS count FROM discovery_tiles WHERE job_id=? AND status='queued'").get(id) as {count:number}).count;
 if(!queued) return reply.code(409).send({error:"No queued or failed tiles are available to retry."});
 db.prepare("UPDATE search_jobs SET status='queued',error_message=NULL,finished_at=NULL WHERE id=?").run(id);
 enqueueDiscoveryJob(id);
 return {jobId:id,status:"queued",retriedTiles:retry.changes,queuedTiles:queued};
});
app.get("/api/jobs",async()=>db.prepare("SELECT id,category,city,locality,status,candidate_count,error_message,source_timestamp,created_at,finished_at FROM search_jobs ORDER BY created_at DESC LIMIT 100").all());
app.listen({host:HOST,port:PORT}).catch(error=>{app.log.error(error);process.exit(1);});
