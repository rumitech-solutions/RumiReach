import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { findFieldConflicts } from "./provenance";
import { normalizeSourceUrl, normalizeWebsite, parseCsv } from "./csv";
import { ensureMatchingSchema, resolveUnlinkedCandidates } from "./matching";
ensureMatchingSchema();
const app=Fastify({logger:true,bodyLimit:2_000_000});
const HOST="127.0.0.1",PORT=Number(process.env.PORT||4317);
app.get("/api/health",async()=>({ok:true,app:"RumiReach",version:"0.2.0"}));
app.get("/api/candidates",async()=>db.prepare("SELECT id,job_id,source_object_type,source_object_id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at,review_status FROM candidates WHERE source_id='user_csv_import' ORDER BY observed_at DESC LIMIT 5000").all());
app.post("/api/import/csv",async(request,reply)=>{
 const body=request.body as{filename?:string;csv?:string};
 if(typeof body?.csv!=="string"||!body.csv.trim())return reply.code(400).send({error:"Provide CSV text in the csv field."});
 if(Buffer.byteLength(body.csv,"utf8")>1_500_000)return reply.code(413).send({error:"CSV exceeds the 1.5 MB import limit."});
 const filename=(body.filename||"business-import.csv").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,100)||"business-import.csv";
 let rows;try{rows=parseCsv(body.csv);}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:"Invalid CSV."});}
 if(rows.length>5000)return reply.code(413).send({error:"CSV exceeds the 5,000 data-row limit."});
 const batchId=randomUUID(),jobId=randomUUID(),createdAt=new Date().toISOString(),sourceId="user_csv_import";
 const sourceUrlFor=(row:Record<string,string>,index:number)=>normalizeSourceUrl(row.source_url||"","csv-import://"+encodeURIComponent(filename)+"#row="+(index+2));
 const insertCandidate=db.prepare("INSERT INTO candidates (id,job_id,source_id,source_object_type,source_object_id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
 const insertObservation=db.prepare("INSERT OR IGNORE INTO field_observations (id,candidate_id,source_id,field_name,field_value,source_url,observed_at,source_timestamp,verification_status,confidence) VALUES (?,?,?,?,?,?,?,?,?,NULL)");
 let imported=0,skipped=0,invalidWebsite=0;
 const run=db.transaction(()=>{
  db.prepare("INSERT OR IGNORE INTO sources (id,name,terms_url,attribution,enabled,reviewed_at) VALUES (?,?,?,?,?,?)").run(sourceId,"User-provided CSV","Operator-supplied dataset; review original source terms before reuse.","Preserve source attribution and only import data you are authorized to use.",1,createdAt);
  db.prepare("INSERT INTO search_jobs (id,category,city,locality,bbox_south,bbox_west,bbox_north,bbox_east,source_id,status,candidate_count,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(jobId,"mixed","CSV import",filename,0,0,0,0,sourceId,"running",0,createdAt,null);
  rows.forEach((row,index)=>{
   const name=(row.name||row.business_name||"").trim();if(!name){skipped++;return;}
   const category=(row.category||row.business_category||"").trim()||"unknown",address=(row.address||"").trim(),phone=(row.phone||row.phone_number||"").trim(),websiteRaw=(row.website||row.website_url||"").trim(),website=normalizeWebsite(websiteRaw),email=(row.email||row.public_email||"").trim();
   if(websiteRaw&&!website)invalidWebsite++;
   const sourceUrl=sourceUrlFor(row,index),candidateId=randomUUID(),observedAt=new Date().toISOString();
   const values:Record<string,string|null>={name,category:(row.category||row.business_category||"").trim()||null,address:address||null,phone:phone||null,website,email:email||null};
   insertCandidate.run(candidateId,jobId,sourceId,"csv_row",batchId+":"+(index+2),name,category,address||null,phone||null,website,email||null,sourceUrl,observedAt,JSON.stringify({filename,rowNumber:index+2,values:row}));
   for(const[field,value]of Object.entries(values))if(value)insertObservation.run(randomUUID(),candidateId,sourceId,field,value,sourceUrl,observedAt,null,"unverified");
   imported++;
  });
  db.prepare("UPDATE search_jobs SET status='completed',candidate_count=?,finished_at=? WHERE id=?").run(imported,new Date().toISOString(),jobId);
 });
 try{run();}catch(error){request.log.error(error,"CSV import failed");return reply.code(500).send({error:"CSV import failed; no partial batch was committed."});}
 const matching=resolveUnlinkedCandidates();
 return{batchId,jobId,sourceId,filename,status:"completed",imported,skipped,invalidWebsite,matching,limit:5000,notice:"Imported values are unverified. Review original source terms before reuse."};
});
app.get("/api/profiles",async()=>db.prepare("SELECT p.id,p.canonical_name,p.category,p.address,p.phone_raw,p.website_url,p.public_email,p.created_at,p.updated_at,COUNT(s.candidate_id) AS source_count FROM business_profiles p LEFT JOIN business_profile_sources s ON s.profile_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 500").all());
app.get("/api/candidates/:id/provenance",async(request,reply)=>{
 const params=request.params as{id:string},candidate=db.prepare("SELECT id,name,category,address,phone_raw,website_url,public_email,source_url,observed_at FROM candidates WHERE id=?").get(params.id);
 if(!candidate)return reply.code(404).send({error:"Candidate not found."});
 const observations=db.prepare("SELECT id,field_name,field_value,source_id,source_url,observed_at,source_timestamp,verification_status,confidence FROM field_observations WHERE candidate_id=? ORDER BY field_name,observed_at DESC").all(params.id) as Array<{field_name:string;field_value:string}>;
 return{candidate,observations,conflicts:findFieldConflicts(observations)};
});
app.patch("/api/candidates/:id/review",async(request,reply)=>{
 const params=request.params as{id:string},body=request.body as{status?:string};
 if(!["accepted","rejected","needs_review","pending"].includes(body?.status||""))return reply.code(400).send({error:"Invalid review status."});
 const result=db.prepare("UPDATE candidates SET review_status=? WHERE id=?").run(body.status,params.id);
 if(!result.changes)return reply.code(404).send({error:"Candidate not found."});
 return{ok:true};
});
app.listen({host:HOST,port:PORT}).catch(error=>{app.log.error(error);process.exit(1);});