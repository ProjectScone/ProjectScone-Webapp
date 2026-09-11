import {useEffect,useMemo,useState} from 'react';
import type {ApiClient} from '../api';
import {EvidenceNetworkCanvas} from './EvidenceNetworkCanvas';
import {parseEntitySearch,type Knowledge} from './knowledge';
import {parseKnowledgePath,pathNetwork,type KnowledgePaths,type PathEntity,type PathRequest} from './knowledge-path';

const message=(error:unknown)=>error instanceof Error?error.message:'Path search failed.';
type Result<T>={data:T;error?:never}|{data?:never;error:string};
export function EntityPicker({api,graph,label,selected,choose}:{api:ApiClient;graph:Knowledge;label:string;selected:PathEntity|null;choose:(entity:PathEntity|null)=>void}){
 const [input,setInput]=useState({graph,text:''}),[attempt,setAttempt]=useState(0);
 const query=input.graph===graph?input.text:'';
 const request=useMemo(()=>({api,graph,query,attempt}),[api,graph,query,attempt]);
 const [snapshot,setSnapshot]=useState<{request:object;result:Result<ReturnType<typeof parseEntitySearch>>}|null>(null);
 useEffect(()=>{
  if(!query.trim()||selected)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{
   api.request<unknown>('/v1/entities?'+new URLSearchParams({q:query,status:graph.mode,as_of:graph.asOf,limit:'20'}),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),cache:'no-store'})
    .then(value=>parseEntitySearch(value,graph,query)).then(data=>{if(!controller.signal.aborted)setSnapshot({request,result:{data}});})
    .catch(error=>{if(!controller.signal.aborted)setSnapshot({request,result:{error:message(error)}});});
  },250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[request,selected]);
 const result=snapshot?.request===request?snapshot.result:null;
 const candidates=query.trim()?result?.data?.entities??[]:graph.entities.slice(0,20);
 return <div className="knowledge-endpoint"><label>{label}<input type="search" maxLength={200} value={selected?.label??query} placeholder="Search this space’s entities" onChange={event=>{setInput({graph,text:event.target.value});choose(null);}}/></label>
  {selected?<p>Selected: {selected.label} <button type="button" className="btn quiet" onClick={()=>{setInput({graph,text:''});choose(null);}}>Change {label.toLowerCase()}</button></p>:<>
   {query.trim()&&!result?<p role="status">Finding entities…</p>:result?.error?<div role="alert"><p>{result.error}</p><button type="button" className="btn quiet" onClick={()=>setAttempt(value=>value+1)}>Retry {label.toLowerCase()} search</button></div>:<>
    <ul aria-label={`${label} candidates`}>{candidates.map(entity=><li key={entity.id}><button type="button" onClick={()=>choose(entity)}><strong>{entity.label}</strong><small>{entity.kind??'Unclassified'} · {entity.key}</small></button></li>)}</ul>
    {!candidates.length&&<p>No matching entities in this read.</p>}
    {result?.data?.coverage.truncated&&<p>Limited results: {result.data.coverage.reasons.map(reason=>reason.replaceAll('_',' ')).join(' · ')}. Refine the search; other entities may exist.</p>}
    {!query.trim()&&<p>Showing {candidates.length} map entities. Type to search beyond the map.</p>}
   </>}
  </>}
 </div>;
}
export function KnowledgePath({api,graph,inspect,clearInspection}:{api:ApiClient;graph:Knowledge;clearInspection:()=>void;inspect:(entity:PathEntity,factIds?:number[])=>void}){
 const [ends,setEnds]=useState<{graph:Knowledge;from:PathEntity|null;to:PathEntity|null}>({graph,from:null,to:null});
 const from=ends.graph===graph?ends.from:null,to=ends.graph===graph?ends.to:null;
 const [hops,setHops]=useState(4),[limit,setLimit]=useState(3),[hubDegree,setHubDegree]=useState(200);
 const parameters=useMemo(()=>from&&to?{from:from.id,to:to.id,max_hops:hops,limit,hub_degree:hubDegree}:null,[from,to,hops,limit,hubDegree]);
 const context=useMemo(()=>({api,graph,parameters}),[api,graph,parameters]);
 const [submitted,setSubmitted]=useState<{context:object;parameters:PathRequest}|null>(null);
 const [snapshot,setSnapshot]=useState<{request:object;result:Result<KnowledgePaths>}|null>(null);
 const [routeIndex,setRouteIndex]=useState(0),[selectedNode,setSelectedNode]=useState<string|null>(null),[selectedEdge,setSelectedEdge]=useState<string|null>(null);
 const request=submitted?.context===context?submitted:null;
 useEffect(()=>{
  setRouteIndex(0);setSelectedNode(null);setSelectedEdge(null);
  if(!request)return;
  const controller=new AbortController(),p=request.parameters;
  api.request<unknown>('/v1/graph/path?'+new URLSearchParams({from:p.from,to:p.to,max_hops:String(p.max_hops),limit:String(p.limit),hub_degree:String(p.hub_degree),status:graph.mode,as_of:graph.asOf}),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),cache:'no-store'})
   .then(value=>parseKnowledgePath(value,graph,p)).then(data=>{if(!controller.signal.aborted)setSnapshot({request,result:{data}});})
   .catch(error=>{if(!controller.signal.aborted)setSnapshot({request,result:{error:message(error)}});});
  return()=>controller.abort();
 },[request]);
 const result=request&&snapshot?.request===request?snapshot.result:null,data=result?.data,path=data?.paths[routeIndex];
 const network=useMemo(()=>path?pathNetwork(path):null,[path]);
 const positions=useMemo(()=>new Map(path?.entities.map((entity,index)=>[entity.id,{x:index*170,y:0}])??[]),[path]);
 const choose=(entity:PathEntity,factIds?:number[])=>{setSelectedNode(entity.id);setSelectedEdge(null);inspect(entity,factIds);};
 const submit=()=>{clearInspection();if(parameters)setSubmitted({context,parameters});};
 return <section className="knowledge-path-workspace" aria-label="Find a connection">
  <p>Find shortest routes through recorded relationships. A route may follow a relationship in either direction; arrows retain what the claim says.</p>
  <div className="knowledge-endpoints"><EntityPicker api={api} graph={graph} label="From" selected={from} choose={value=>{clearInspection();setEnds({graph,from:value,to});}}/><EntityPicker api={api} graph={graph} label="To" selected={to} choose={value=>{clearInspection();setEnds({graph,from,to:value});}}/></div>
  <div className="knowledge-path-options"><label>Maximum hops<select value={hops} onChange={event=>{clearInspection();setHops(Number(event.target.value));}}>{Array.from({length:8},(_,i)=><option key={i+1}>{i+1}</option>)}</select></label><label>Maximum routes<select value={limit} onChange={event=>{clearInspection();setLimit(Number(event.target.value));}}>{[1,3,5,10,20].map(value=><option key={value}>{value}</option>)}</select></label><label>Hub threshold<select value={hubDegree} onChange={event=>{clearInspection();setHubDegree(Number(event.target.value));}}>{[2,10,50,200,1000,100000].map(value=><option key={value}>{value}</option>)}</select></label><button type="button" className="btn primary" disabled={!parameters} onClick={submit}>Find routes</button></div>
  <p className="muted">Entities with more than {hubDegree} neighbors are skipped as intermediate stops. Endpoints may still be hubs.</p>
  {request&&!result&&<p role="status">Tracing recorded connections…</p>}
  {result?.error&&<div role="alert"><p>{result.error}</p><button type="button" className="btn quiet" onClick={submit}>Retry path search</button></div>}
  {data&&<div className="knowledge-path-result" aria-label="Path result">
   {!data.complete&&<p role="status">Partial ledger read: {data.coverage.reasons.map(reason=>reason.replaceAll('_',' ')).join(' · ')}. Other connections may exist.</p>}
   {data.hubs.length>0&&<p>Skipped {data.hubs.length} intermediate hubs: {data.hubs.slice(0,10).map(entity=>entity.label).join(', ')}{data.hubs.length>10?'…':''}. This search does not establish whether routes through those hubs exist.</p>}
   {data.status==='none_within_limit'&&<p>No route within {hops} hops. A longer route exists in the searched graph.</p>}
   {data.status==='disconnected'&&<p>No connection found in the searched graph{data.hubs.length?' under the hub policy':''}.</p>}
   {data.status==='not_connected_in_read'&&<p>No connection found in the facts read. The limited read cannot establish that these entities are disconnected.</p>}
   {path&&network&&<>
    <div className="knowledge-path-options"><label>Route<select value={routeIndex} onChange={event=>{clearInspection();setRouteIndex(Number(event.target.value));setSelectedNode(null);setSelectedEdge(null);}}>{data.paths.map((path,index)=><option key={index} value={index}>Route {index+1} · {path.hops.length} hops</option>)}</select></label><span>{data.truncated?`Showing ${data.paths.length} routes; more shortest routes exist.`:`${data.paths.length} shortest route${data.paths.length===1?'':'s'} returned.`}</span></div>
    <div className="knowledge-path-map"><EvidenceNetworkCanvas nodes={network.nodes} edges={network.edges} positions={positions} groupColors={false} selectedNode={selectedNode} selectedEdge={selectedEdge} selectNode={id=>{const entity=path.entities.find(entity=>entity.id===id);if(entity)choose(entity);}} selectEdge={id=>{clearInspection();setSelectedEdge(id);setSelectedNode(null);}} reset={()=>{clearInspection();setSelectedNode(null);setSelectedEdge(null);}}/></div>
    {!path.hops.length&&<p>The endpoints are the same entity; no relationship hop is needed.</p>}
    <ol className="knowledge-path-hops">{path.hops.map((hop,index)=><li key={hop.id} data-active={selectedEdge===hop.id}><strong>Hop {index+1}{hop.direction==='reverse'?' · traversed in reverse':''}</strong><p><button type="button" onClick={()=>choose(hop.subject)}>{hop.subject.label}</button> → {hop.predicate.replaceAll('_',' ')} → <button type="button" onClick={()=>choose(hop.object)}>{hop.object.label}</button></p><small>Supporting claims: {hop.factIds.slice(0,20).join(', ')}{hop.factIds.length>20?` · ${hop.factIds.length-20} more`:''}</small><button type="button" className="btn quiet" onClick={()=>choose(hop.subject,hop.factIds)}>Inspect supporting records for hop {index+1}</button></li>)}</ol>
   </>}
  </div>}
 </section>;
}
