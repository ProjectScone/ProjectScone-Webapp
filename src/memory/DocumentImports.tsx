import {useEffect,useRef,useState} from 'react';
import type {ApiClient} from '../api';
import {DocumentOriginal} from './DocumentOriginal';
import {SourceDocumentEvidence} from './SourceDocumentEvidence';
import {SourcePageLink} from './SourcePageLink';
import {importDocument,parseDocumentFormats,validateDocumentSelection,verifyDocumentImport,type DocumentFormats,type ImportOutcome,type ImportPhase,type VerifiedImport} from './document-import';
import './document-import.css';

type Row={id:number;file:File}&({status:'queued'|ImportPhase}|ImportOutcome);
const phaseLabel:Record<Row['status'],string>={queued:'Ready',uploading:'Uploading original',indexing:'Extracting and indexing',verifying:'Verifying source',verified:'Verified',unverified:'Saved · verification needed',uncertain:'Save unconfirmed',failed:'Import failed'};
const bytes=(size:number)=>size>=1048576?`${(size/1048576).toFixed(1)} MiB`:`${size.toLocaleString()} bytes`;
const failure=(error:unknown)=>error instanceof Error?error.message:'The document request failed.';

export function DocumentImports({api,onSaved}:{api:ApiClient;onSaved:()=>void}){
 const [open,setOpen]=useState(false);
 return open?<ImportWorkspace api={api} onSaved={onSaved} close={()=>setOpen(false)}/>:<div className="source-entry"><button className="btn" onClick={()=>setOpen(true)}>Import documents</button><span>Keep original files with their extracted source evidence.</span></div>;
}
function ImportWorkspace({api,onSaved,close}:{api:ApiClient;onSaved:()=>void;close:()=>void}){
 const [catalog,setCatalog]=useState<DocumentFormats|null>(null),[discoveryError,setDiscoveryError]=useState(''),[attempt,setAttempt]=useState(0);
 const [rows,setRows]=useState<Row[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pausing,setPausing]=useState(false);
 const liveRows=useRef<Row[]>([]),active=useRef(false),pause=useRef(false),nextId=useRef(1),lifetime=useRef(new AbortController());
 const savedCallback=useRef(onSaved);savedCallback.current=onSaved;
 const update=(next:Row[])=>{liveRows.current=next;setRows(next);};
 const patch=(id:number,value:Row)=>update(liveRows.current.map(row=>row.id===id?value:row));
 useEffect(()=>{
  const controller=new AbortController();lifetime.current=controller;
  update([]);active.current=false;setBusy(false);setPausing(false);setError('');
  return()=>controller.abort();
 },[api]);
 useEffect(()=>{
  const controller=new AbortController();setCatalog(null);setDiscoveryError('');
  void api.request<unknown>('/v1/documents/formats',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'})
   .then(parseDocumentFormats).then(value=>{if(!controller.signal.aborted)setCatalog(value);})
   .catch(error=>{if(!controller.signal.aborted)setDiscoveryError(failure(error));});
  return()=>controller.abort();
 },[api,attempt]);
 useEffect(()=>{
  if(!busy&&!rows.some(row=>row.status==='queued'||row.status==='uncertain'||row.status==='unverified'))return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[busy,rows]);
 const queued=rows.filter(row=>row.status==='queued').length,verified=rows.filter(row=>row.status==='verified').length;
 const choose=(files:FileList|null)=>{
  if(!files||!catalog||active.current)return;
  const chosen=Array.from(files);
  try{validateDocumentSelection([...liveRows.current.map(row=>row.file),...chosen],catalog);update([...liveRows.current,...chosen.map(file=>({id:nextId.current++,file,status:'queued' as const}))]);setError('');}
  catch(error){setError(failure(error));}
 };
 const run=async()=>{
  if(active.current||!catalog)return;
  active.current=true;pause.current=false;setBusy(true);setPausing(false);setError('');const signal=lifetime.current.signal;
  try{
   while(!pause.current&&!signal.aborted){
    const row=liveRows.current.find(row=>row.status==='queued');if(!row)break;
    const result=await importDocument(api,row.file,catalog,signal,status=>{if(!signal.aborted)patch(row.id,{id:row.id,file:row.file,status});});
    if(signal.aborted)return;
    patch(row.id,{id:row.id,file:row.file,...result});
    if(result.status==='verified'||result.status==='unverified')savedCallback.current();
    if(result.status==='uncertain'||result.status==='failed')break;
   }
  }finally{if(!signal.aborted){active.current=false;setBusy(false);setPausing(false);}}
 };
 const retryRead=async(row:Row)=>{
  if(active.current||row.status!=='unverified')return;
  active.current=true;setBusy(true);const signal=lifetime.current.signal;
  patch(row.id,{id:row.id,file:row.file,status:'verifying'});
  try{const verified=await verifyDocumentImport(api,row.receipt,signal);if(!signal.aborted)patch(row.id,{id:row.id,file:row.file,status:'verified',verified});}
  catch(error){if(!signal.aborted)patch(row.id,{...row,error:failure(error)});}
  finally{if(!signal.aborted){active.current=false;setBusy(false);}}
 };
 return <section className="document-import" aria-label="Document import queue">
  <header><div><span className="eyebrow">Add to your sources</span><h2>Import documents</h2></div><button className="btn quiet small" disabled={busy} onClick={close}>Close import queue</button></header>
  <p>Upload original files, extract their text, and verify the saved source. PDF imports read embedded text; scanned pages need the separate OCR workflow.</p>
  <p className="import-session">Keep this Documents view open until imports finish. This queue stays in this view only; closing it or navigating away clears the queue. Saved sources remain in your library.</p>
  {!catalog&&!discoveryError&&<p role="status">Checking supported formats…</p>}
  {discoveryError&&<div role="alert"><p>{discoveryError}</p><button className="btn quiet" onClick={()=>setAttempt(n=>n+1)}>Retry format discovery</button></div>}
  {catalog&&<>
   <label className="import-picker">Choose documents<input type="file" multiple disabled={busy} accept={Array.from(catalog.formats).filter(([,format])=>format.available).map(([extension])=>extension).join(',')} onChange={event=>{choose(event.target.files);event.target.value='';}}/><small>Up to {bytes(catalog.maxInputBytes)} per file · 20 files / 100 MiB per queue</small></label>
   <details className="import-formats"><summary>Supported formats and availability</summary><ul>{Array.from(catalog.formats,([extension,format])=><li key={extension}><strong>{extension}</strong><span>{format.available?'Available':'Unavailable on this server'}{format.requires?` · ${format.requires}`:''}</span></li>)}</ul><p>Availability checks installed parsers. A damaged, encrypted, or unsupported file variant can still fail extraction.</p></details>
  </>}
  {error&&<p role="alert" className="err">{error}</p>}
  {rows.length>0&&<>
   <div className="import-actions"><p role="status">{verified} of {rows.length} verified · {queued} ready</p><div><button className="btn" disabled={busy||!queued||!catalog} onClick={()=>void run()}>Import {queued} ready {queued===1?'file':'files'}</button>{busy&&<button className="btn quiet" disabled={pausing} onClick={()=>{pause.current=true;setPausing(true);}}>{pausing?'Pausing after this file…':'Pause after this file'}</button>}</div></div>
   <ol className="import-list">{rows.map(row=><li key={row.id} className={'import-row import-'+row.status}>
    <div className="import-row-heading"><div><strong>{row.file.name}</strong><small>{bytes(row.file.size)}</small></div><span role="status" className="import-state">{phaseLabel[row.status]}</span></div>
    {'error' in row&&<p role="alert">{row.error}</p>}
    {row.status==='failed'&&<><p>Indexing was not started or permission was denied. An uploaded original may remain stored. Retry only after resolving the failure.</p><button className="btn quiet small" disabled={busy} onClick={()=>patch(row.id,{id:row.id,file:row.file,status:'queued'})}>Queue retry</button></>}
    {row.status==='uncertain'&&<p>The server may have saved this source. Check your source library before importing this file again. This queue will not repeat an uncertain write.</p>}
    {row.status==='unverified'&&<><p>Source #{row.receipt.episodeId} was acknowledged. Verification did not finish; retrying below only reads that source.</p><button className="btn quiet small" disabled={busy} onClick={()=>void retryRead(row)}>Retry source verification</button></>}
    {row.status==='verified'&&<ImportEvidence api={api} value={row.verified}/>}
    {!busy&&<button className="btn quiet small import-remove" onClick={()=>update(liveRows.current.filter(item=>item.id!==row.id))}>{row.status==='queued'?'Remove from queue':'Dismiss receipt'}</button>}
   </li>)}</ol>
  </>}
 </section>;
}
function ImportEvidence({api,value}:{api:ApiClient;value:VerifiedImport}){
 const [page,setPage]=useState(0),{receipt,source,evidence}=value;
 return <div className="import-evidence"><p>Source #{receipt.episodeId} · {receipt.segments} extracted {receipt.segments===1?'segment':'segments'} · {receipt.format}{receipt.deduplicated?' · Existing source reused':''}</p>
  <SourcePageLink api={api} episodeId={receipt.episodeId}/>
  <details><summary>Inspect extracted source</summary><p>{evidence.filename} · {evidence.parser}. Original identity and extracted text match the saved source.</p><ul>{evidence.segments.slice(page*20,(page+1)*20).map((segment,index)=><li key={page*20+index}><strong>{segment.locator}</strong><pre>{segment.text}</pre></li>)}</ul>{evidence.segments.length>20&&<nav aria-label="Extracted segment pages"><button className="btn quiet small" disabled={!page} onClick={()=>setPage(page-1)}>Previous segments</button><span>Page {page+1} of {Math.ceil(evidence.segments.length/20)}</span><button className="btn quiet small" disabled={(page+1)*20>=evidence.segments.length} onClick={()=>setPage(page+1)}>Next segments</button></nav>}<p className="import-digest">Original SHA-256: {receipt.original.attachment_id}</p></details>
  <details><summary>Download original file</summary><DocumentOriginal api={api} source={source} episodeId={receipt.episodeId}/></details>
  {evidence.tables.length>0&&<SourceDocumentEvidence api={api} episodeId={receipt.episodeId} source={source}/>}
 </div>;
}
