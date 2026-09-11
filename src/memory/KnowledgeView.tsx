import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {ApiClient} from '../api';
import {KnowledgePath} from './KnowledgePath';
import type {PathEntity} from './knowledge-path';
import {KnowledgeCommunities,KnowledgeImportance} from './KnowledgeCommunities';
import {analysisGroups} from './knowledge-analysis';
import {EvidenceNetworkCanvas} from './EvidenceNetworkCanvas';
import {verifiedSpace} from './source-address';
import {SourcePageLink} from './SourcePageLink';
import {useSourceNavigation} from './SourceNavigation';
import {KNOWLEDGE_MODES,knowledgeNetwork,parseEntityDetail,parseKnowledge,type Coverage,type EntityDetail,type Knowledge,type KnowledgeMode} from './knowledge';
import './query-evidence.css';
import './knowledge.css';

type Result<T>={data:T;error?:never}|{data?:never;error:string};
const claimLabel=(ids:number[])=>ids.slice(0,20).join(', ')+(ids.length>20?` · ${ids.length-20} more`: '');
const errorText=(error:unknown)=>error instanceof Error?error.message:'The knowledge request failed.';
function CoverageNotice({value}:{value:Coverage}){
 return <div className="knowledge-coverage" role="status"><strong>{value.truncated?'Partial view':'Returned view'}</strong><span>{value.counts.facts_read??0} ledger claims read{value.counts.facts_counted!==undefined?` · ${value.counts.facts_counted} match this view`:''}</span>{value.reasons.length>0&&<span>{value.reasons.map(reason=>reason.replaceAll('_',' ')).join(' · ')}</span>}</div>;
}
export function KnowledgeView({api,detailsAvailable,statusAvailable,analysisAvailable,pathsAvailable}:{api:ApiClient;detailsAvailable:boolean;statusAvailable:boolean;analysisAvailable:boolean;pathsAvailable:boolean}){
 const [mode,setMode]=useState<KnowledgeMode>('current'),[attempt,setAttempt]=useState(0);
 const [showAnalysis,setShowAnalysis]=useState(false);
 const analysisEnabled=analysisAvailable&&showAnalysis;
 const request=useMemo(()=>({api,mode,attempt,statusAvailable,analysisEnabled}),[api,mode,attempt,statusAvailable,analysisEnabled]);
 const [snapshot,setSnapshot]=useState<{request:typeof request;result:Result<Knowledge>}|null>(null);
 const [selection,setSelection]=useState<{graph:Knowledge;id:string;reference?:PathEntity;factIds?:number[];fromPath?:boolean}|null>(null);
 const clearPathInspection=useCallback(()=>setSelection(previous=>previous?.fromPath?null:previous),[]);
 const [query,setQuery]=useState('');
 const inspector=useRef<HTMLElement>(null);
 const [community,setCommunity]=useState<{graph:Knowledge;id:string}|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]);
  Promise.all([api.request<unknown>('/v1/graph/knowledge?'+new URLSearchParams({status:mode,limit:'150',attribute_limit:'1000',...(analysisEnabled?{groupings:'true'}:{})}),{signal,cache:'no-store'}),statusAvailable?api.request<unknown>('/v1/status',{signal,cache:'no-store'}).then(verifiedSpace):Promise.resolve(undefined)])
   .then(([value,space])=>parseKnowledge(value,mode,space)).then(data=>{if(analysisEnabled&&!data.analysis)throw Error('The server did not return the requested community analysis.');if(!controller.signal.aborted)setSnapshot({request,result:{data}});})
   .catch(error=>{if(!controller.signal.aborted)setSnapshot({request,result:{error:errorText(error)}});});
  return()=>controller.abort();
 },[request]);
 const result=snapshot?.request===request?snapshot.result:null,graph=result?.data;
 const selected=graph&&selection?.graph===graph&&(!selection.fromPath||(pathsAvailable&&detailsAvailable))?selection.id:null;
 const network=useMemo(()=>graph?knowledgeNetwork(graph):null,[graph]);
 const groups=useMemo(()=>graph?.analysis?analysisGroups(graph.analysis,graph.entities.map(entity=>entity.id)):undefined,[graph]);
 const communityId=graph&&community?.graph===graph?community.id:'';
 const allowed=useMemo(()=>{const group=groups?.groups.find(group=>group.id===communityId);return group?new Set(group.nodeIds):null;},[groups,communityId]);
 const map=useMemo(()=>network?{nodes:network.nodes.filter(node=>!allowed||allowed.has(node.id)),edges:network.edges.filter(edge=>!allowed||(allowed.has(edge.source)&&allowed.has(edge.target)))}:null,[network,allowed]);
 const visible=graph?.entities.filter(entity=>(!allowed||allowed.has(entity.id))&&`${entity.label} ${entity.key} ${entity.kind??''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))??[];
 const choose=(id:string)=>{if(graph){if(allowed&&!allowed.has(id))setCommunity(null);setSelection({graph,id});}};
 const edges=useMemo(()=>map?.edges.slice(0,1000)??[],[map]);
 return <section className="knowledge-workspace" aria-label="Knowledge workspace">
  <div className="knowledge-toolbar"><label>Claims <select value={mode} onChange={event=>setMode(event.target.value as KnowledgeMode)}>{KNOWLEDGE_MODES.map(value=><option key={value} value={value}>{value==='current'?'Current':value==='history'?'History':value==='proposed'?'Awaiting review':'Include excluded'}</option>)}</select></label><button className="btn quiet" onClick={()=>setAttempt(value=>value+1)}>Refresh graph</button>{analysisAvailable&&<label><input type="checkbox" checked={showAnalysis} onChange={event=>setShowAnalysis(event.target.checked)}/>Show communities</label>}<span>Relationships come from recorded claims.</span></div>
  {!result?<p role="status">Reading this space’s knowledge…</p>:result.error?<div role="alert"><h2>Knowledge could not be loaded</h2><p>{result.error}</p><button className="btn quiet" onClick={()=>setAttempt(value=>value+1)}>Try again</button></div>:graph&&network&&map&&<>
   <CoverageNotice value={graph.coverage}/>
   {graph.analysis&&groups&&<KnowledgeCommunities analysis={graph.analysis} groups={groups} selected={communityId} choose={id=>{setCommunity({graph,id});setSelection(null);}}/>}
   {pathsAvailable&&detailsAvailable&&<details className="knowledge-path"><summary>Find a connection</summary><KnowledgePath api={api} graph={graph} clearInspection={clearPathInspection} inspect={(entity,factIds)=>{setCommunity(null);setSelection({graph,id:entity.id,reference:entity,factIds,fromPath:true});requestAnimationFrame(()=>{inspector.current?.focus({preventScroll:true});inspector.current?.scrollIntoView({block:'nearest'});});}}/></details>}
   <div className="knowledge-summary"><strong>{graph.entities.length} entities</strong><span>{graph.relations.length} relationships</span><span>{graph.attributes.length} value{graph.attributes.length===1?'':'s'}</span><span>As of {new Date(graph.asOf).toLocaleString()}</span></div>
   {!graph.entities.length?<div className="knowledge-empty"><h2>No entities in this view</h2><p>Store and extract claims, or choose another claim view. {graph.coverage.truncated?'This read was limited, so absence is not conclusive.':''}</p></div>:<div className="knowledge-layout">
    <aside className="knowledge-directory" aria-label="Entity directory"><label>Find in this view<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Name or kind"/></label><p>{visible.length} of {graph.entities.length} entities</p><ul>{visible.map(entity=><li key={entity.id}><button type="button" aria-pressed={selected===entity.id} onClick={()=>choose(entity.id)}><strong>{entity.label}</strong><span>{entity.kind??'Unclassified'} · {entity.claims} claims</span></button></li>)}</ul>{!visible.length&&<p>No matching entities in the returned view.</p>}</aside>
    <div className="knowledge-map"><EvidenceNetworkCanvas nodes={map.nodes} edges={edges} groups={groups} groupColors={Boolean(groups)} selectedNode={selected} selectedEdge={null} selectNode={choose} selectEdge={id=>{const edge=edges.find(edge=>edge.id===id);if(edge)choose(edge.source);}} reset={()=>setSelection(null)}/>{edges.length<map.edges.length&&<p className="knowledge-map-limit">Map draws {edges.length} of {map.edges.length} relationships in this filter. Select an entity to inspect its recorded support.</p>}</div>
    <aside ref={inspector} tabIndex={-1} className="knowledge-inspector" aria-label="Entity inspection">{selected?<EntityInspector key={selected} api={api} graph={graph} selected={selected} reference={selection?.reference} focusFacts={selection?.factIds} available={detailsAvailable} choose={choose}/>:<div className="knowledge-empty"><h2>Follow a connection</h2><p>Select an entity in the map or directory to inspect its relationships, values and supporting sources.</p></div>}</aside>
   </div>}
  </>}
 </section>;
}
function EntityInspector({api,graph,selected,reference,focusFacts,available,choose}:{api:ApiClient;graph:Knowledge;selected:string;reference?:PathEntity;focusFacts?:number[];available:boolean;choose:(id:string)=>void}){
 const [claimPage,setClaimPage]=useState(0);
 const [attempt,setAttempt]=useState(0),[snapshot,setSnapshot]=useState<{request:object;result:Result<EntityDetail>}|null>(null);
 const request=useMemo(()=>({api,graph,selected,attempt,focusFacts}),[api,graph,selected,attempt,focusFacts]);
 const source=useSourceNavigation();
 useEffect(()=>{
  if(!available)return;
  setClaimPage(0);
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]);
  api.request<unknown>('/v1/entities/'+encodeURIComponent(selected)+'?'+new URLSearchParams({status:graph.mode,as_of:graph.asOf,limit:'100'}),{signal,cache:'no-store'})
   .then(value=>parseEntityDetail(value,graph,selected)).then(data=>{if(!controller.signal.aborted)setSnapshot({request,result:{data}});})
   .catch(error=>{if(!controller.signal.aborted)setSnapshot({request,result:{error:errorText(error)}});});
  return()=>controller.abort();
 },[request,available]);
 const result=snapshot?.request===request?snapshot.result:null;
 const detail=result?.data,entity=graph.entities.find(entity=>entity.id===selected)??detail?.entity;
 const expected=useMemo(()=>focusFacts?new Set(focusFacts):null,[focusFacts]);
 const records=detail?.facts.filter(fact=>!expected||expected.has(fact.id))??[];
 const shownFacts=records.slice(claimPage*50,(claimPage+1)*50);
 return <><div className="knowledge-entity-title"><span>{entity?.kind??'Unclassified entity'}{entity?` · ${entity.kindStatus}`:''}</span><h2>{entity?.label??reference?.label??selected}</h2>{entity&&<p>{entity.claims} supporting claims in the displayed view</p>}</div>
  {graph.analysis&&<KnowledgeImportance analysis={graph.analysis} entityId={selected}/>}
  {!available?<p>This server does not offer entity inspection.</p>:!result?<p role="status">Checking supporting records…</p>:result.error?<div role="alert"><p>{result.error}</p><button className="btn quiet" onClick={()=>setAttempt(value=>value+1)}>Retry inspection</button></div>:detail&&<>
   {!detail.consistent&&<p role="alert">The ledger changed during this read. These records may disagree; refresh before relying on them.</p>}
   <CoverageNotice value={detail.coverage}/>
   {!detail.complete&&<p>Only part of the ledger was read. Other connections may exist.</p>}
   <h3>Connections</h3>{!detail.relations.length&&<p>No connections in this returned detail.</p>}
   {detail.relations.map((relation,index)=><div className="knowledge-connection" key={index}><span>{relation.direction==='outgoing'?'→':'←'} {relation.predicate.replaceAll('_',' ')}</span>{graph.entities.some(entity=>entity.id===relation.other.id)?<button type="button" onClick={()=>choose(relation.other.id)}>{relation.other.label}</button>:<strong>{relation.other.label} <small>(outside map)</small></strong>}<small>Claims {claimLabel(relation.factIds)}</small></div>)}
   <h3>Recorded values</h3>{!detail.attributes.length&&<p>No values in this returned detail.</p>}{detail.attributes.map((attribute,index)=><div className="knowledge-value" key={index}><strong>{attribute.predicate.replaceAll('_',' ')}</strong><p>{attribute.value}</p><small>Claims {claimLabel(attribute.factIds)}</small></div>)}
   <h3>Supporting records</h3>{expected&&<p>Filtered to this hop’s {expected.size} supporting claims.{records.length<expected.size?` ${expected.size-records.length} were not returned by this inspection; the evidence shown is incomplete.`:''}</p>}<p>{records.length} returned records{records.length>50?` · showing ${claimPage*50+1}–${Math.min((claimPage+1)*50,records.length)}`:''}</p>{shownFacts.map(fact=><article className="knowledge-fact" key={fact.id}><strong>Claim {fact.id}</strong><p>{fact.subject} · {fact.predicate} · {fact.object}</p><small>{fact.status}{fact.excluded?' · excluded':''} · {fact.origin} · {fact.grounding.replaceAll('_',' ')}</small>{fact.quote&&<blockquote>{fact.quote}</blockquote>}{fact.sourceId&&source?.api===api&&source.discovery.state==='ready'&&source.discovery.space===graph.space&&fact.grounding!=='quote_source_mismatch'?<SourcePageLink api={api} episodeId={fact.sourceId}/>:<p className="muted">{fact.sourceId?'Source is not verified in the current space.':'No retained source for this claim.'}</p>}</article>)}{records.length>50&&<nav className="knowledge-record-pages" aria-label="Supporting record pages"><button className="btn quiet" disabled={claimPage===0} onClick={()=>setClaimPage(value=>value-1)}>Previous records</button><button className="btn quiet" disabled={(claimPage+1)*50>=records.length} onClick={()=>setClaimPage(value=>value+1)}>Next records</button></nav>}
  </>}
 </>;
}
