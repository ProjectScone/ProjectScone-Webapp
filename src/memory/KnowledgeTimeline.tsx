import {useEffect,useMemo,useRef,useState} from 'react';
import type {ApiClient} from '../api';
import type {Knowledge} from './knowledge';
import {parseKnowledgeTimeline,timelineExtent,type KnowledgeTimelineData,type TimelineItem} from './knowledge-timeline';
import {SourcePageLink} from './SourcePageLink';
import {useSourceNavigation} from './SourceNavigation';
import './knowledge-timeline.css';

const date=(value:number)=>new Date(value).toISOString();
export function KnowledgeTimeline({api,graph,entityId,label}:{api:ApiClient;graph:Knowledge;entityId:string;label:string}){
 const [moment,setMoment]=useState(new Date(graph.asOf).toISOString().slice(0,-1)),[limit,setLimit]=useState('200');
 const [submission,setSubmission]=useState<{api:ApiClient;graph:Knowledge;entityId:string;asOf:string;limit:string}|null>(null);
 const [snapshot,setSnapshot]=useState<{request:object;data?:KnowledgeTimelineData;error?:string}|null>(null);
 const [selection,setSelection]=useState<{data:KnowledgeTimelineData;id:number}|null>(null),[lane,setLane]=useState(''),[heldOnly,setHeldOnly]=useState(false),[page,setPage]=useState(0);
 const inspection=useRef<HTMLElement>(null);
 const request=useMemo(()=>submission?.api===api&&submission.graph===graph&&submission.entityId===entityId?submission:null,[submission,api,graph,entityId]);
 const source=useSourceNavigation();
 const valid=Number.isFinite(Date.parse(moment+'Z'))&&Number.isInteger(Number(limit))&&Number(limit)>=1&&Number(limit)<=500;
 useEffect(()=>{
  if(!request)return;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
  api.request<unknown>('/v1/graph/timeline?'+new URLSearchParams({entity:entityId,as_of:request.asOf,limit:request.limit}),{signal,cache:'no-store'})
   .then(value=>parseKnowledgeTimeline(value,graph,entityId,request.asOf,Number(request.limit))).then(data=>{if(!controller.signal.aborted)setSnapshot({request,data});})
   .catch(error=>{if(!controller.signal.aborted)setSnapshot({request,error:error instanceof Error?error.message:'The timeline could not be read.'});});
  return()=>controller.abort();
 },[request]);
 const result=request&&snapshot?.request===request?snapshot:null,data=result?.data;
 const selected=data&&selection?.data===data?data.items.find(item=>item.id===selection.id):null;
 const filtered=data?.items.filter(item=>(!heldOnly||item.holds)&&(!lane||`${item.role}:${item.predicate}`===lane))??[];
 const shown=filtered.slice(page*20,(page+1)*20),visibleIds=new Set(shown.map(item=>item.id));
 const extent=useMemo(()=>data?timelineExtent(data.items,data.asOf):[0,1],[data]);
 const position=(value:number)=>Math.max(0,Math.min(100,(value-extent[0])/(extent[1]-extent[0])*100));
 const choose=(item:TimelineItem)=>{
  if(!data)return;
  const nextLane=lane===`${item.role}:${item.predicate}`?lane:'',nextHeld=heldOnly&&item.holds;
  const visible=data.items.filter(candidate=>(!nextHeld||candidate.holds)&&(!nextLane||`${candidate.role}:${candidate.predicate}`===nextLane));
  setLane(nextLane);setHeldOnly(nextHeld);setPage(Math.floor(visible.findIndex(candidate=>candidate.id===item.id)/20));setSelection({data,id:item.id});
  requestAnimationFrame(()=>{inspection.current?.focus({preventScroll:true});inspection.current?.scrollIntoView({block:'nearest'});});
 };
 const clear=()=>{setSubmission(null);setSnapshot(null);setSelection(null);setLane('');setHeldOnly(false);setPage(0);};
 return <details className="knowledge-timeline"><summary>Timeline · {label}</summary><section aria-label="Entity timeline">
  <p>Follow this entity’s recorded history by valid time. This view includes closed, proposed and excluded claims, independently of the map’s claim filter.</p>
  <form onSubmit={event=>{event.preventDefault();if(valid){setSelection(null);setLane('');setHeldOnly(false);setPage(0);setSubmission({api,graph,entityId,asOf:date(Date.parse(moment+'Z')),limit});}}}>
   <label>Inspect at (UTC)<input type="datetime-local" step="0.001" required value={moment} onChange={event=>{clear();setMoment(event.target.value);}}/></label>
   <label>Maximum records<input type="number" min="1" max="500" step="1" required value={limit} onChange={event=>{clear();setLimit(event.target.value);}}/></label>
   <button className="btn quiet" disabled={!valid}>{request?'Refresh timeline':'Read timeline'}</button>{request&&<button className="btn quiet" type="button" onClick={clear}>{result?'Clear timeline':'Cancel timeline'}</button>}
  </form>
  {request&&!result&&<p role="status">Reading valid-time history…</p>}{result?.error&&<p role="alert">{result.error}</p>}
  {data&&<>
   <h3>{label} · recorded history</h3><p role="status">{data.coverage.truncated?'Partial timeline':'Returned timeline'} · {data.items.length} of {data.coverage.total} records{data.coverage.reasons.length?` · ${data.coverage.reasons.map(reason=>reason.replaceAll('_',' ')).join(' · ')}`:''}. When limited, the server returns the most recent valid-time records.</p>
   <div className="knowledge-timeline-filters"><label>Relationship lane<select value={lane} onChange={event=>{setLane(event.target.value);setPage(0);setSelection(null);}}><option value="">All lanes</option>{data.lanes.map(lane=><option key={lane.id} value={lane.id}>{lane.role==='subject'?'Outgoing':lane.role==='object'?'Incoming':'Value'} · {lane.predicate.replaceAll('_',' ')}</option>)}</select></label><label><input type="checkbox" checked={heldOnly} onChange={event=>{setHeldOnly(event.target.checked);setPage(0);setSelection(null);}}/>Only records counted at the selected time</label></div>
   <p>Validity includes the start and excludes the end. Blue bars count at the selected time; amber marks proposals and red marks excluded records. An arrow means no end is recorded.</p>
   <div className="knowledge-timeline-axis"><span>{date(extent[0])}</span><span>{date(extent[1])}</span></div><p className="knowledge-timeline-moment">Selected time: {date(data.asOf)}</p>
   {!shown.length&&<p>No returned records match this timeline filter.{data.coverage.truncated?' Limited coverage cannot establish absence.':''}</p>}
   {data.lanes.filter(lane=>lane.itemIds.some(id=>visibleIds.has(id))).map(lane=><section key={lane.id} className="knowledge-timeline-lane" aria-label={`${lane.role} ${lane.predicate}`}><h4>{lane.role==='subject'?'Outgoing':lane.role==='object'?'Incoming':'Value'} · {lane.predicate.replaceAll('_',' ')}</h4>{shown.filter(item=>lane.itemIds.includes(item.id)).map(item=><button key={item.id} className="knowledge-timeline-item" aria-pressed={selected?.id===item.id} onClick={()=>choose(item)} aria-label={`Inspect claim ${item.id}: ${item.subject} ${item.predicate} ${item.object}, valid from ${date(item.from)} until ${item.until===null?'no recorded end':date(item.until)}`}><span>Claim {item.id} · {item.subject} → {item.object}</span><span className="knowledge-timeline-track" aria-hidden="true"><i className="knowledge-timeline-marker" style={{left:`${position(data.asOf)}%`}}/><i className={`knowledge-timeline-bar ${item.excluded?'excluded':item.status==='proposed'?'proposed':item.holds?'held':'historical'}`} style={{left:`${position(item.from)}%`,width:`${Math.max(.3,position(item.until??extent[1])-position(item.from))}%`}}>{item.until===null?'→':''}</i></span><small>{date(item.from)} → {item.until===null?'No recorded end':date(item.until)} · {item.status}{item.excluded?' · excluded':''}</small></button>)}</section>)}
   {filtered.length>20&&<nav aria-label="Timeline record pages"><button className="btn quiet" disabled={!page} onClick={()=>{setPage(page-1);setSelection(null);}}>Previous timeline records</button><span>Page {page+1} of {Math.ceil(filtered.length/20)}</span><button className="btn quiet" disabled={(page+1)*20>=filtered.length} onClick={()=>{setPage(page+1);setSelection(null);}}>Next timeline records</button></nav>}
   {selected&&<aside ref={inspection} tabIndex={-1} className="knowledge-timeline-record" aria-label="Timeline record inspection"><h3>Claim {selected.id}</h3><p>{selected.subject} · {selected.predicate} · {selected.object}</p><p>{selected.status}{selected.excluded?' · excluded':''} · {selected.origin} · {selected.grounding.replaceAll('_',' ')}</p><p>{selected.holds?'Counts at the selected time.':'Does not count at the selected time.'} Valid from {date(selected.from)} until {selected.until===null?'no recorded end':date(selected.until)}.</p>{selected.quote&&<blockquote>{selected.quote}</blockquote>}{selected.sourceId!==null&&source?.api===api&&source.discovery.state==='ready'&&source.discovery.space===graph.space&&selected.grounding!=='quote_source_mismatch'&&<SourcePageLink api={api} episodeId={selected.sourceId}/>}
    {selected.supersededBy!==null&&<p>Superseded by claim {data.items.some(item=>item.id===selected.supersededBy)?<button className="knowledge-timeline-link" onClick={()=>choose(data.items.find(item=>item.id===selected.supersededBy)!)}>{selected.supersededBy}</button>:`${selected.supersededBy} (outside returned records)`}</p>}
    <h4>Recorded claim links</h4>{!data.relations.some(relation=>relation.from===selected.id||relation.to===selected.id)&&<p>No links returned for this record.</p>}{data.relations.filter(relation=>relation.from===selected.id||relation.to===selected.id).map((relation,index)=><p key={index}>Claim {relation.from} → {relation.kind.replaceAll('_',' ')} → Claim {relation.to} <button className="knowledge-timeline-link" onClick={()=>choose(data.items.find(item=>item.id===(relation.from===selected.id?relation.to:relation.from))!)}>Inspect linked claim</button></p>)}<button className="btn quiet" onClick={()=>setSelection(null)}>Clear timeline inspection</button>
   </aside>}
  </>}
 </section></details>;
}
