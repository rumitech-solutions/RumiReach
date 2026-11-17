import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { SearchRequestSchema } from "@rumireach/shared";
import { db } from "./db";
import { discoverRestaurants } from "./overpass";
import { findFieldConflicts } from "./provenance";
import { normalizeSourceUrl, normalizeWebsite, parseCsv } from "./csv";

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
app.post("/api/search",async(request,reply)=>{
  const parsed=SearchRequestSchema.safeParse(request.body);
  if(!parsed.success) return reply.code(400).send({error:"Invalid search request",details:parsed.error.flatten()});
  const input=parsed.data;
  const area=(input.bbox.north-input.bbox.south)*(input.bbox.east-input.bbox.west);
  if(area<=0 || area>0.05) return reply.code(400).send({error:"Bounding box is invalid or too large. Maximum area is 0.05 square degrees."});
  const source=db.prepare("SELECT enabled FROM sources WHERE id='osm_overpass'").get() as {enabled:number}|undefined;
  if(!source?.enabled) return reply.code(403).send({error:"OSM source is disabled pending policy review."});
  const jobId=randomUUID(),createdAt=new Date().toISOString();
  db.prepare("INSERT INTO search_jobs (id,category,city,locality,bbox_south,bbox_west,bbox_north,bbox_east,source_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    jobId,input.category,input.city,input.locality,input.bbox.south,input.bbox.west,input.bbox.north,input.bbox.east,"osm_overpass","running",createdAt
  );
  try {
    const result=await discoverRestaurants({jobId,bbox:input.bbox,maxResults:input.maxResults});
    db.prepare("UPDATE search_jobs SET status='completed',candidate_count=?,source_timestamp=?,finished_at=? WHERE id=?").run(result.count,result.sourceTimestamp,new Date().toISOString(),jobId);
    return {jobId,status:"completed",candidateCount:result.count,sourceTimestamp:result.sourceTimestamp,attribution:"© OpenStreetMap contributors — data available under the Open Database License (ODbL)"};
  } catch(error) {
    const message=error instanceof Error?error.message:"Unknown source error";
    db.prepare("UPDATE search_jobs SET status='failed',error_message=?,finished_at=? WHERE id=?").run(message,new Date().toISOString(),jobId);
    request.log.error({jobId,error:message},"Discovery job failed");
    return reply.code(502).send({jobId,status:"failed",error:message});
  }
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
  return {batchId,jobId,sourceId,filename,status:"completed",imported,skipped,invalidWebsite,limit:5000,notice:"Imported values are unverified. CSV rows are kept as separate candidates; cross-source matching and deduplication are not yet enabled."};
});
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
app.get("/api/jobs",async()=>db.prepare("SELECT id,category,city,locality,status,candidate_count,error_message,source_timestamp,created_at,finished_at FROM search_jobs ORDER BY created_at DESC LIMIT 100").all());
app.listen({host:HOST,port:PORT}).catch(error=>{app.log.error(error);process.exit(1);});
