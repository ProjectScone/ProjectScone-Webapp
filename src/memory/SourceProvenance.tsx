import {useEffect,useMemo,useRef,useState} from 'react';
import type {ApiClient} from '../api';
import {parseSourceProvenance,type ProvenanceSource,type SourceProvenanceData,type SourceSpan} from './source-provenance';
import './source-provenance.css';

export function SourceProvenance({api,source}:{api:ApiClient;source:ProvenanceSource}){
 const [attempt,setAttempt]=useState(0),[enabled,setEnabled]=useState(false),[chunkLimit,setChunkLimit]=useState('64'),[claimLimit,setClaimLimit]=useState('200');
 const request=useMemo(()=>({api,source,attempt,enabled,chunkLimit,claimLimit}),[api,source,attempt,enabled,chunkLimit,claimLimit]);
 const [snapshot,setSnapshot]=useState<{request:object;data?:SourceProvenanceData;error?:string}|null>(null);
 const [selection,setSelection]=useState<{data:SourceProvenanceData;title:string;span:SourceSpan}|null>(null);
 const [filter,setFilter]=useState<{data:SourceProvenanceData;entity:string}|null>(null);
 const [pages,setPages]=useState<{data:SourceProvenanceData;claims:number;chunks:number;sections:number;mentions:number}|null>(null);
 const excerpt=useRef<HTMLElement>(null);
 const result=snapshot?.request===request?snapshot:null,data=result?.data,selected=data&&selection?.data===data?selection:null;
 const entity=data&&filter?.data===data?filter.entity:'';
 const page=data&&pages?.data===data?pages:{claims:0,chunks:0,sections:0,mentions:0};
 const claims=data?.claims.filter(claim=>!entity||claim.entityIds.includes(entity))??[];
 const valid=[chunkLimit,claimLimit].every(value=>Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=1000);
 useEffect(()=>{
  if(!enabled||!valid)return;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
  api.request<unknown>('/v1/graph/sources?'+new URLSearchParams({episode:String(source.episodeId),max_chunks:chunkLimit,max_claims:claimLimit}),{signal,cache:'no-store'})
   .then(value=>parseSourceProvenance(value,source,{maxChunks:Number(chunkLimit),maxClaims:Number(claimLimit)})).then(data=>{if(!controller.signal.aborted)setSnapshot({request,data});})
   .catch(error=>{if(!controller.signal.aborted)setSnapshot({request,error:error instanceof Error?error.message:'Source provenance could not be read.'});});
  return()=>controller.abort();
 },[request]);
 const clear=()=>{setEnabled(false);setSnapshot(null);setSelection(null);setFilter(null);setPages(null);};
 const inspect=(title:string,span:SourceSpan)=>{if(data){setSelection({data,title,span});requestAnimationFrame(()=>{excerpt.current?.focus({preventScroll:true});excerpt.current?.scrollIntoView({block:'nearest'});});}};
 function pager(kind:'claims'|'chunks'|'sections'|'mentions',total:number){if(!data||total<=20)return null;return <nav aria-label={`Source ${kind} pages`}><button className="btn quiet" disabled={!page[kind]} onClick={()=>setPages({data,...page,[kind]:page[kind]-1})}>Previous {kind}</button><span>Page {page[kind]+1} of {Math.ceil(total/20)}</span><button className="btn quiet" disabled={(page[kind]+1)*20>=total} onClick={()=>setPages({data,...page,[kind]:page[kind]+1})}>Next {kind}</button></nav>;}
 return <details className="source-provenance"><summary>Follow this source’s evidence</summary><section aria-label="Source provenance">
  <p>Follow exact source spans into stored chunks and recorded claims. Entity mentions found in the text are shown separately from entities named by claims.</p>
  <form onSubmit={event=>{event.preventDefault();if(valid){setSelection(null);setFilter(null);setPages(null);setEnabled(true);setAttempt(value=>value+1);}}}>
   <label>Maximum chunks<input type="number" min="1" max="1000" step="1" required value={chunkLimit} onChange={event=>{clear();setChunkLimit(event.target.value);}}/></label>
   <label>Maximum claims<input type="number" min="1" max="1000" step="1" required value={claimLimit} onChange={event=>{clear();setClaimLimit(event.target.value);}}/></label>
   <button className="btn quiet" disabled={!valid}>{enabled?'Refresh provenance':'Read provenance'}</button>{enabled&&<button className="btn quiet" type="button" onClick={clear}>{result?'Clear provenance':'Cancel provenance'}</button>}
  </form>
  {enabled&&!result&&<p role="status">Checking the original and its evidence…</p>}{result?.error&&<p role="alert">{result.error}</p>}
  {data&&<>
   <p role="status">{data.coverage.truncated?'Partial provenance':'Returned provenance'} · {data.chunks.length} of {data.coverage.chunksTotal} chunks · {data.claims.length} claims{data.coverage.reasons.length?` · ${data.coverage.reasons.map(reason=>reason.replaceAll('_',' ')).join(' · ')}`:''}</p>
   {selected&&<aside ref={excerpt} tabIndex={-1} className="source-provenance-excerpt" aria-label="Selected original span"><h3>{selected.title}</h3><p>UTF-8 bytes {selected.span.start}–{selected.span.end}, end exclusive</p><pre>{selected.span.text.length<=8000?selected.span.text:selected.span.text.slice(0,8000)}</pre>{selected.span.text.length>8000&&<details><summary>Read the complete selected span ({selected.span.text.length} characters)</summary><pre>{selected.span.text}</pre></details>}<button className="btn quiet" onClick={()=>setSelection(null)}>Clear selected span</button></aside>}
   <h3>Sections</h3>{!data.sections.length&&<p>No Markdown heading sections found.</p>}
   <ol>{data.sections.slice(page.sections*20,(page.sections+1)*20).map(section=><li key={section.id}><button className="source-provenance-link" onClick={()=>inspect(section.title,section.span)}>{section.title}</button><small>Heading level {section.level} · Bytes {section.span.start}–{section.span.end}</small></li>)}</ol>{pager('sections',data.sections.length)}
   <h3>Stored chunks</h3>{!data.chunks.length&&<p>No stored chunks returned.</p>}
   <ul>{data.chunks.slice(page.chunks*20,(page.chunks+1)*20).map(chunk=><li key={chunk.id}><button className="source-provenance-link" onClick={()=>inspect(`Chunk ${chunk.id}`,chunk.span)}>Chunk {chunk.id}</button><small>Position {chunk.ordinal+1} · {chunk.section??'No heading section'} · Bytes {chunk.span.start}–{chunk.span.end}</small></li>)}</ul>{pager('chunks',data.chunks.length)}
   <h3>Entities named by claims</h3>{!data.entities.length&&<p>No entity names returned for these claims.{data.coverage.truncated?' Limited coverage can omit names.':''}</p>}
   {data.entities.length>0&&<label>Filter claims by entity<select value={entity} onChange={event=>{setFilter({data,entity:event.target.value});setPages({data,...page,claims:0});setSelection(null);}}><option value="">All returned claims</option>{data.entities.map(entity=><option key={entity.id} value={entity.id}>{entity.label} · {entity.claimIds.length} claims</option>)}</select></label>}
   <h3>Recorded claims</h3>{!claims.length&&<p>No claims in this filter.</p>}
   {claims.slice(page.claims*20,(page.claims+1)*20).map(claim=><article key={claim.id}><h4>Claim {claim.id}</h4><p>{claim.subject} · {claim.predicate} · {claim.object}</p><p>{claim.status}{claim.excluded?' · excluded':''} · {claim.grounding.replaceAll('_',' ')}</p>{claim.quote&&<blockquote>{claim.quote}</blockquote>}{claim.span?<><button className="source-provenance-link" onClick={()=>inspect(`Claim ${claim.id} quote`,claim.span!)}>Inspect quoted source span</button><p>{claim.occurrences} exact occurrence{claim.occurrences===1?'':'s'} in the original.{claim.occurrences>1?' The span identifies the first occurrence.':''} {claim.section??'No heading section'}</p></>:<p>No verified quote span is available.</p>}<div>Overlapping chunks: {claim.chunkIds.length?claim.chunkIds.map((id,index)=>{const chunk=data.chunks.find(chunk=>chunk.id===id);return <span key={id}>{index?', ':''}{chunk?<button className="source-provenance-link" onClick={()=>inspect(`Chunk ${id}`,chunk.span)}>{id}</button>:`${id} (outside returned chunks)`}</span>}):'none returned'}</div></article>)}{pager('claims',claims.length)}
   <h3>Text-only entity mentions</h3><p>A matching name in the original does not establish a claim about that entity.</p>{!data.mentions.length&&<p>No additional known names matched.</p>}
   <ul>{data.mentions.slice(page.mentions*20,(page.mentions+1)*20).map(mention=><li key={mention.id}><button className="source-provenance-link" onClick={()=>inspect(`Mention of ${mention.label}`,mention.span)}>{mention.label}</button><small>{mention.occurrences} matched occurrence{mention.occurrences===1?'':'s'} · first at bytes {mention.span.start}–{mention.span.end}</small></li>)}</ul>{pager('mentions',data.mentions.length)}
  </>}
 </section></details>;
}
