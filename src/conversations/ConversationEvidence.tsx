import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {ApiError,type ApiClient} from '../api';
import {SourceImages} from '../components/SourceImages';
import {SourceContent} from '../components/SourceContent';
import {episode,type Episode,type TurnResult} from './contracts';
import {QueryEvidenceGraph} from '../memory/QueryEvidenceGraph';
import {useConversationFade} from './useConversationFade';
import {PerformanceDetails} from './PerformanceDetails';
import type {TurnPerformance} from './performance';

export type InspectorView='sources'|'map'|'activity';
export function ConversationEvidence({api,result,performance,selected,onSelect,view,onView,onClose}:{api:ApiClient;result?:TurnResult;performance?:TurnPerformance;selected:number|null;onSelect:(id:number)=>void;view:InspectorView;onView:(view:InspectorView)=>void;onClose:()=>void}){
  const inspectorRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    const trigger=document.activeElement;
    inspectorRef.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus({preventScroll:window.innerWidth>780});
    return()=>{if(trigger instanceof HTMLElement&&trigger.isConnected)trigger.focus();};
  },[]);
  const [attempt,setAttempt]=useState(0);
  const [snapshot,setSnapshot]=useState<{api:ApiClient;selected:number;attempt:number;source?:Episode;error?:string}|null>(null);
  const current=snapshot?.api===api&&snapshot.selected===selected&&snapshot.attempt===attempt?snapshot:null;
  const source=current?.source,error=current?.error;
  const sourceFade=useConversationFade<HTMLElement>(`${selected}:${attempt}:${source?'ready':error?'error':'pending'}`);
  useEffect(()=>{
    const controller=new AbortController();setSnapshot(null);
    if(selected!==null)api.request(`/v1/episodes/${selected}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])})
      .then(value=>{
        const source=episode(value);
        if(source.episode_id!==selected)throw Error('Source identity mismatch');
        if(!controller.signal.aborted)setSnapshot({api,selected,attempt,source});
      })
      .catch(reason=>{
        const error=reason instanceof ApiError&&reason.status===410?'This source was forgotten. Its retained text is no longer available.'
          :reason instanceof ApiError&&reason.status===404?'Source unavailable in this memory space.'
          :'Source could not be loaded in this memory space.';
        if(!controller.signal.aborted)setSnapshot({api,selected,attempt,error});
      });
    return()=>controller.abort();
  },[api,selected,attempt]);
  const context=result?.memory_context;
  return <aside ref={inspectorRef} className="conversation-evidence" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}} aria-label="Conversation evidence">
    <header className="inspector-heading"><h2>Inspector</h2><button onClick={onClose} aria-label="Close inspector">×</button></header>
    <div className="inspector-tabs" role="tablist" aria-label="Inspect conversation">{(['sources','map','activity'] as const).map(tab=><button key={tab} id={'inspector-tab-'+tab} role="tab" tabIndex={view===tab?0:-1} onKeyDown={event=>{const tabs:InspectorView[]=['sources','map','activity'];const index=tabs.indexOf(tab);const next=event.key==='ArrowRight'?tabs[(index+1)%3]:event.key==='ArrowLeft'?tabs[(index+2)%3]:event.key==='Home'?tabs[0]:event.key==='End'?tabs[2]:null;if(next){event.preventDefault();onView(next);document.getElementById('inspector-tab-'+next)?.focus();}}} aria-selected={view===tab} aria-controls={'inspector-panel-'+tab} onClick={()=>onView(tab)}>{tab==='sources'?'Sources':tab==='map'?'Evidence map':'Activity'}</button>)}</div>
    <div role="tabpanel" id="inspector-panel-activity" aria-labelledby="inspector-tab-activity" hidden={view!=='activity'}><PerformanceDetails value={performance}/></div>
    <div role="tabpanel" id="inspector-panel-sources" aria-labelledby="inspector-tab-sources" hidden={view!=='sources'}>
    <section><h3>Latest reply context</h3>{context?<><span className="conversation-state">{context.status}</span>
      {context.references.length?<div className="conversation-source-list">{context.references.map((ref,i)=><button key={`${ref.episode_id}:${i}`} onClick={()=>onSelect(ref.episode_id)}>Source episode {ref.episode_id}</button>)}</div>:<p>No source references recorded for this reply.</p>}
      <details className="evidence-explanation"><summary>About this evidence</summary><p className="conversation-caption">These sources were prepared for the model; their presence does not verify the answer. Provider completion remains unverified.</p></details></>:<p>Source details appear when a reply’s saved context is available.</p>}</section>
    <section ref={sourceFade} className="conversation-source-transition"><h3>{selected===null?'Inspect a saved message':`Episode ${selected}`}</h3>
      {selected===null?<p>Select a message’s source record to read the saved original.</p>:error?<div role="alert"><p>{error}</p><button className="btn quiet small" onClick={()=>setAttempt(n=>n+1)}>Retry source</button></div>:source?<><div className="conversation-source-text"><SourceContent text={source.content}/></div><SourceImages key={source.episode_id} episodeId={source.episode_id} api={api}/></>:<p role="status">Loading source…</p>}
    </section>
    </div>
    <div role="tabpanel" id="inspector-panel-map" aria-labelledby="inspector-tab-map" hidden={view!=='map'}>{context?.evidence_graph!=null?<QueryEvidenceGraph value={context.evidence_graph} api={api} title="Evidence supplied to this reply" context="reply"/>:<div className="inspector-empty"><h3>No evidence map for this reply</h3><p>A map appears when retained source relationships are available.</p><Link to="/playground">Explore your memory →</Link></div>}</div>
  </aside>;
}
