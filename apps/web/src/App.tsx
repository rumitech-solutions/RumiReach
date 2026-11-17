import {useEffect,useState} from "react";
type Candidate={id:string;name:string|null;category:string|null;address:string|null;phone_raw:string|null;website_url:string|null;source_url:string;review_status:string};
export default function App(){
 const [city,setCity]=useState("Karachi"),[locality,setLocality]=useState("Gulshan-e-Iqbal");
 const [south,setSouth]=useState(""),[west,setWest]=useState(""),[north,setNorth]=useState(""),[east,setEast]=useState("");
 const [maxResults,setMaxResults]=useState(50),[candidates,setCandidates]=useState<Candidate[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("Enter a reviewed boundary before running the OSM query.");
 async function load(jobId?:string){const r=await fetch(jobId?"/api/candidates?jobId="+encodeURIComponent(jobId):"/api/candidates");if(r.ok)setCandidates(await r.json());}
 useEffect(()=>{void load();},[]);
 async function run(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{
  const r=await fetch("/api/search",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({category:"restaurant",city,locality,bbox:{south:Number(south),west:Number(west),north:Number(north),east:Number(east)},maxResults})});
  const d=await r.json();if(!r.ok)throw new Error(d.error||"Search failed");setNotice(d.attribution+" · OSM data timestamp: "+(d.sourceTimestamp||"not provided"));await load(d.jobId);
 }catch(err){setError(err instanceof Error?err.message:"Unexpected error");}finally{setBusy(false);}}
 async function review(id:string,status:string){const r=await fetch("/api/candidates/"+id+"/review",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status})});if(r.ok)setCandidates(xs=>xs.map(x=>x.id===id?{...x,review_status:status}:x));}
 return <main className="shell">
 <header><div className="brand"><b>R</b><div><strong>RumiReach</strong><small>DISCOVER · QUALIFY · CONNECT</small></div></div><span className="local">● Local workspace</span></header>
 <section className="hero"><small>RUMITECH SOLUTIONS · CLIENT DISCOVERY</small><h1>Find the businesses<br/><em>worth connecting with.</em></h1><p>Discover restaurants from permitted public data, review source evidence, and build a clean prospect list. No paid data API required.</p></section>
 <section className="panel"><div className="heading"><div><i>01</i><div><h2>Discover businesses</h2><p>First source: OpenStreetMap via Overpass</p></div></div><span>OSM · ODbL</span></div>
 <form onSubmit={run}><div className="grid two"><label>Category<input value="Restaurants" disabled/></label><label>City<input value={city} onChange={e=>setCity(e.target.value)} required/></label><label className="wide">Area / locality<input value={locality} onChange={e=>setLocality(e.target.value)} required/></label></div>
 <div className="boundary"><strong>Search boundary</strong><small>Enter reviewed bounding box coordinates (decimal degrees)</small></div>
 <div className="grid four">{[["South latitude",south,setSouth],["West longitude",west,setWest],["North latitude",north,setNorth],["East longitude",east,setEast]].map(([label,value,setter])=><label key={label as string}>{label as string}<input required inputMode="decimal" placeholder="Decimal degrees" value={value as string} onChange={e=>(setter as (v:string)=>void)(e.target.value)}/></label>)}</div>
 <div className="actions"><label>Maximum candidates<select value={maxResults} onChange={e=>setMaxResults(Number(e.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><button disabled={busy}>{busy?"Searching…":"Run discovery →"}</button></div></form>
 <div className="notice">ⓘ {notice}</div>{error&&<div className="error">{error}</div>}</section>
 <section className="panel"><div className="heading"><div><i>02</i><div><h2>Candidate review</h2><p>Verify records before treating them as prospects.</p></div></div><span>{candidates.length} records</span></div>
 {!candidates.length?<div className="empty"><b>⌕</b><strong>No candidates yet</strong><p>Run a discovery query to populate this list. OSM coverage varies by locality.</p></div>:
 <div className="tablewrap"><table><thead><tr><th>Business</th><th>Address</th><th>Phone</th><th>Website</th><th>Review</th><th>Source</th></tr></thead><tbody>{candidates.map(c=><tr key={c.id}><td><strong>{c.name||"Name not listed"}</strong><small>{c.category||"Restaurant"}</small></td><td>{c.address||"Not listed"}</td><td>{c.phone_raw||"Not listed"}</td><td>{c.website_url?<a href={c.website_url} target="_blank" rel="noreferrer">Open ↗</a>:"Not listed"}</td><td><select value={c.review_status} onChange={e=>void review(c.id,e.target.value)}><option value="pending">Pending</option><option value="accepted">Accept</option><option value="needs_review">Needs review</option><option value="rejected">Reject</option></select></td><td><a href={c.source_url} target="_blank" rel="noreferrer">OSM ↗</a></td></tr>)}</tbody></table></div>}
 <p className="footnote">Missing phone or website means this source did not provide that field. It does not prove the business has no phone or website.</p></section>
 <footer>RumiReach by RumiTech Solutions <span>Research responsibly. Keep every source traceable.</span></footer></main>;
}
