import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { SearchRequestSchema } from "@rumireach/shared";
import { db } from "./db";
import { discoverRestaurants } from "./overpass";

const app = Fastify({logger:true,bodyLimit:32768});
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
app.patch("/api/candidates/:id/review",async(request,reply)=>{
  const params=request.params as {id:string},body=request.body as {status?:string};
  if(!["accepted","rejected","needs_review"].includes(body?.status||"")) return reply.code(400).send({error:"Invalid review status."});
  const result=db.prepare("UPDATE candidates SET review_status=? WHERE id=?").run(body.status,params.id);
  if(!result.changes) return reply.code(404).send({error:"Candidate not found."});
  return {ok:true};
});
app.get("/api/jobs",async()=>db.prepare("SELECT id,category,city,locality,status,candidate_count,error_message,source_timestamp,created_at,finished_at FROM search_jobs ORDER BY created_at DESC LIMIT 100").all());
app.listen({host:HOST,port:PORT}).catch(error=>{app.log.error(error);process.exit(1);});
