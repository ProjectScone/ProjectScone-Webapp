import {useEffect,useMemo,useState} from 'react';
import type {ApiClient} from '../api';
import type {Knowledge} from './knowledge';
import {parseKnowledgeReport,type KnowledgeReportData,type ReportEntity,type ReportSettings} from './knowledge-report';

export function KnowledgeReport({api,graph,inspect,clearInspection}:{api:ApiClient;graph:Knowledge;inspect?: (entity:ReportEntity,factIds?:number[])=>void;clearInspection:()=>void}){
 const [resolution,setResolution]=useState('1'),[hubs,setHubs]=useState('');
 const [submission,setSubmission]=useState<{api:ApiClient;graph:Knowledge;settings:ReportSettings}|null>(null);
 const [snapshot,setSnapshot]=useState<{request:object;data?:KnowledgeReportData;error?:string}|null>(null);
 const [page,setPage]=useState(0);
 const [hubPage,setHubPage]=useState(0);
 const request=useMemo(()=>submission?.api===api&&submission.graph===graph?submission:null,[submission,api,graph]);
 const valid=Number.isFinite(Number(resolution))&&Number(resolution)>0&&Number(resolution)<=10&&(!hubs||(Number.isFinite(Number(hubs))&&Number(hubs)>=50&&Number(hubs)<=100));
 const result=request&&snapshot?.request===request?snapshot:null,data=result?.data;
 useEffect(()=>{
  if(!request)return;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]);
  const {settings}=request;
  const query=new URLSearchParams({status:graph.mode,as_of:graph.asOf,format:'json',resolution:String(settings.resolution),...(settings.excludeHubs!==null?{exclude_hubs:String(settings.excludeHubs)}:{})});
  api.request<unknown>('/v1/graph/report?'+query,{signal,cache:'no-store'})
   .then(value=>parseKnowledgeReport(value,graph,settings)).then(data=>{if(!controller.signal.aborted)setSnapshot({request,data});})
   .catch(error=>{if(!controller.signal.aborted)setSnapshot({request,error:error instanceof Error?error.message:'The report could not be read.'});});
  return()=>controller.abort();
 },[request]);
 const clear=()=>{setSubmission(null);setSnapshot(null);setPage(0);setHubPage(0);clearInspection();};
 const names=new Map<string,ReportEntity>(graph.entities.map(entity=>[entity.id,entity]));
 if(data)for(const entity of [...data.central,...data.hubs,...data.bridges,...data.communities.flatMap(g=>g.central),...data.connections.flatMap(c=>[c.subject,c.object])])names.set(entity.id,entity);
 const name=(entity:ReportEntity,factIds?:number[])=>inspect?<button type="button" className="knowledge-report-entity" onClick={()=>inspect(entity,factIds)}>{entity.label}</button>:<strong>{entity.label}</strong>;
 const support=(ids:number[])=>ids.length?<p className="knowledge-report-support">Supporting claim IDs: {ids.slice(0,20).join(', ')}{ids.length>20?` · ${ids.length-20} more`:''}</p>:null;
 return <section className="knowledge-report" aria-label="Knowledge report">
  <p>Explore the full returned claim view, including entities outside the map. Communities, rankings and suggested questions are computed analysis.</p>
  <form onSubmit={event=>{event.preventDefault();if(valid){clearInspection();setPage(0);setHubPage(0);setSubmission({api,graph,settings:{resolution:Number(resolution),excludeHubs:hubs?Number(hubs):null}});}}}>
   <label>Community resolution<input type="number" min="0" max="10" step="any" required value={resolution} onChange={event=>{clear();setResolution(event.target.value);}}/></label>
   <label>Exclude hubs above degree percentile<input type="number" min="50" max="100" step="any" placeholder="Include all" value={hubs} onChange={event=>{clear();setHubs(event.target.value);}}/></label>
   <button className="btn quiet" disabled={!valid} type="submit">{request?'Regenerate report':'Generate report'}</button>
   {request&&<button className="btn quiet" type="button" onClick={clear}>{result?'Clear report':'Cancel report'}</button>}
  </form>
  <p>Resolution above 1 favors smaller communities; below 1 favors larger ones. Leave the percentile empty to include every hub, or enter 50–100 to exclude hubs from the central ranking. Those entities remain in their communities.</p>
  {request&&!result&&<p role="status">Computing the knowledge report…</p>}
  {result?.error&&<p role="alert">{result.error}</p>}
  {data&&<div className="knowledge-report-result">
   <h3>Report overview</h3><p>{data.summary.entities} entities · {data.summary.relations} relationships · {data.summary.attributes} values · {data.summary.communities} communities · {data.summary.isolated} isolated entities</p>
   <p>Resolution {data.resolution} · Modularity {data.modularity.toPrecision(3)} · {data.hubs.length} hubs excluded from the central ranking{data.excludeHubs!==null?` above degree percentile ${data.excludeHubs}`:''}.</p>
   <p>{data.analysed} of {data.total} connected entities analysed. {data.estimated?`Bridge scores estimated from ${data.betweenness.split(':')[1]} sampled sources.`:'Bridge scores computed exactly.'} Scores measure graph structure, not claim reliability.</p>
   <p role="status">{data.coverage.truncated?'Partial report':'Returned report'} · {data.coverage.counts.facts_counted} claims counted of {data.coverage.counts.facts_read} read{data.coverage.reasons.length?` · ${data.coverage.reasons.map(reason=>reason.replaceAll('_',' ')).join(' · ')}`:''}</p>
   <h3>Central entities</h3>{!data.central.length&&<p>No entities in this ranking.</p>}
   <ol className="knowledge-report-ranking">{data.central.map(entity=><li key={entity.id}>{name(entity)}<span>{entity.community} · {entity.degree} neighbors · PageRank {entity.pagerank.toPrecision(3)} · Bridge score {entity.betweenness.toPrecision(3)}</span></li>)}</ol>
   {data.hubs.length>0&&<details><summary>{data.hubs.length} excluded hubs</summary><ul>{data.hubs.slice(hubPage*50,(hubPage+1)*50).map(entity=><li key={entity.id}>{name(entity)} · {entity.degree} neighbors</li>)}</ul>{data.hubs.length>50&&<nav aria-label="Excluded hubs"><button className="btn quiet" disabled={!hubPage} onClick={()=>setHubPage(hubPage-1)}>Previous hubs</button><span>Page {hubPage+1} of {Math.ceil(data.hubs.length/50)}</span><button className="btn quiet" disabled={(hubPage+1)*50>=data.hubs.length} onClick={()=>setHubPage(hubPage+1)}>Next hubs</button></nav>}</details>}
   <h3>Bridging entities</h3>{!data.bridges.length&&<p>No bridging entities returned.</p>}<ul>{data.bridges.map(entity=><li key={entity.id}>{name(entity)} · Participation {entity.participation.toPrecision(3)} · Bridge score {entity.betweenness.toPrecision(3)}</li>)}</ul>
   <h3>Cross-community connections</h3>{!data.connections.length&&<p>No cross-community connections returned.</p>}
   {data.connections.map(connection=><article key={connection.id}>{name(connection.subject,connection.factIds)} <span>→ {connection.predicate.replaceAll('_',' ')} → </span>{name(connection.object,connection.factIds)}<p>{connection.reason}</p>{support(connection.factIds)}<p>{connection.links} links between these communities</p></article>)}
   <h3>Suggested questions</h3>{!data.suggestions.length&&<p>No questions returned.</p>}
   {data.suggestions.map((question,index)=><article key={index}><p>{question.text}</p><div className="knowledge-report-names">{question.entityIds.map(id=><span key={id}>{name(names.get(id)??{id,key:id,label:id})}</span>)}</div>{support(question.factIds)}{question.relationIds.length>0&&<p className="knowledge-report-support">Relationship IDs: {question.relationIds.join(', ')}</p>}<small>Suggested from graph structure; inspect the entities to check the underlying records.</small></article>)}
   <h3>Communities</h3>{!data.communities.length&&<p>No linked communities returned.</p>}
   {data.communities.slice(page*20,(page+1)*20).map(group=><article key={group.id}><h4>{group.label}</h4><p>{group.size} entities · {group.internalLinks} internal links · {group.boundaryLinks} boundary links · Cohesion {group.cohesion===null?'unavailable':group.cohesion.toPrecision(3)}</p><div className="knowledge-report-names">{group.central.map(entity=><span key={entity.id}>{name(entity)}</span>)}</div><p>Kinds: {group.kinds.map(([kind,count])=>`${kind} (${count})`).join(', ')||'none'}</p><p>Predicates: {group.predicates.map(([predicate,count])=>`${predicate} (${count})`).join(', ')||'none'}</p></article>)}
   {data.communities.length>20&&<nav aria-label="Report communities"><button className="btn quiet" disabled={!page} onClick={()=>setPage(page-1)}>Previous communities</button><span>Page {page+1} of {Math.ceil(data.communities.length/20)}</span><button className="btn quiet" disabled={(page+1)*20>=data.communities.length} onClick={()=>setPage(page+1)}>Next communities</button></nav>}
  </div>}
 </section>;
}
