import {displayFilename} from './filename-display';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ApiClient} from '../api';
import {ImportEvidence,PdfOcrControls,VideoImportChoice,documentAccept} from './DocumentImports';
import {videoFilename} from './document-video-import';
import {parseDocumentFormats,validateDocumentSelection,type DocumentFormats,type VerifiedImport} from './document-import';
import {validatePdfOcr,type PdfOcrSelection} from './document-ocr';
import {canResumeDocumentJob,canVerifyDocumentJob,controlDocumentJob,parseDocumentJob,readDocumentJobRequest,readDocumentJobs,verifyDocumentJob,type DocumentJob,type DocumentJobPage,type DocumentJobSubmission} from './document-jobs';
import './document-import.css';

// Client identity scopes expectations to this connection and retains them across navigation.
const submissions=new WeakMap<ApiClient,Map<string,DocumentJobSubmission>>();
function submittedFor(api:ApiClient){let saved=submissions.get(api);if(!saved){saved=new Map();submissions.set(api,saved);}return saved;}

type PendingFile={id:string;file:File;pdfOcr?:PdfOcrSelection;videoOcr?:boolean;state:'queued'|'uploading'|'admitting'|'admitted'|'uncertain';error?:string};
const failure=(error:unknown)=>error instanceof Error?error.message:'The import request failed.';
const labels:Record<DocumentJob['status'],string>={registered:'Waiting for explicit resume',created:'Starting import',running:'Working',interrupted:'Interrupted',cancelled:'Cancelled',completed:'Indexing completed',failed:'Attempt failed',sources_invalid:'Source no longer valid',verification_unavailable:'Source verification unavailable',deadline:'Deadline reached',outcome_unknown:'Outcome uncertain',retry_not_allowed:'Cannot retry this stage',unavailable:'Job unavailable'};
const requestOptions=(signal:AbortSignal):RequestInit=>({signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});

export function DurableDocumentImports({api,onSaved}:{api:ApiClient;onSaved:()=>void}){
 const identity=useMemo(()=>crypto.randomUUID(),[api]);
 return <ImportJobsWorkspace key={identity} api={api} onSaved={onSaved}/>;
}
function ImportJobsWorkspace({api,onSaved}:{api:ApiClient;onSaved:()=>void}){
 const [picker,setPicker]=useState(false),[catalog,setCatalog]=useState<DocumentFormats|null>(null),[catalogError,setCatalogError]=useState('');
 const [queue,setQueue]=useState<PendingFile[]>([]),[uploading,setUploading]=useState(false),[queueError,setQueueError]=useState('');
 const [videoForNew,setVideoForNew]=useState(false);
 const [cursors,setCursors]=useState<(string|undefined)[]>([undefined]),[version,setVersion]=useState(0);
 const [snapshot,setSnapshot]=useState<{after:string|undefined;page:DocumentJobPage}|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [acting,setActing]=useState<string|null>(null),[actionError,setActionError]=useState('');
 const [evidence,setEvidence]=useState<{id:string;value:VerifiedImport}|null>(null);
 const lifetime=useRef(new AbortController()),busy=useRef(false),controlBusy=useRef(false),rows=useRef(queue),saved=useRef(onSaved);
 saved.current=onSaved;
 const after=cursors.at(-1),page=snapshot&&snapshot.after===after?snapshot.page:null;
 const refresh=()=>setVersion(value=>value+1);
 const updateQueue=(next:PendingFile[])=>{rows.current=next;setQueue(next);};
 const patch=(id:string,changes:Partial<PendingFile>)=>updateQueue(rows.current.map(row=>row.id===id?{...row,...changes}:row));
 useEffect(()=>{const controller=new AbortController();lifetime.current=controller;return()=>controller.abort();},[]);
 useEffect(()=>{
  const controller=new AbortController();
  void api.request<unknown>('/v1/documents/formats',requestOptions(controller.signal)).then(parseDocumentFormats)
   .then(value=>{if(!controller.signal.aborted)setCatalog(value);}).catch(error=>{if(!controller.signal.aborted)setCatalogError(failure(error));});
  return()=>controller.abort();
 },[api]);
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  setLoading(true);setError('');
  void readDocumentJobs(api,controller.signal,after).then(value=>{
   if(controller.signal.aborted)return;
   setSnapshot({after,page:value});setLoading(false);
   if(value.items.some(job=>job.activeLocal))timer=setTimeout(()=>setVersion(value=>value+1),1500);
  }).catch(error=>{if(!controller.signal.aborted){setError(failure(error));setLoading(false);}});
  return()=>{controller.abort();clearTimeout(timer);};
 },[api,after,version]);
 useEffect(()=>{
  if(!queue.some(row=>row.state!=='admitted'))return;
  const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);
  return()=>window.removeEventListener('beforeunload',warn);
 },[queue]);
 const choose=(files:FileList|null)=>{
  if(!catalog||!files||busy.current)return;
  try{
   const chosen=Array.from(files).map(file=>({id:'import-'+crypto.randomUUID(),file,videoOcr:videoForNew&&videoFilename(file.name),state:'queued' as const}));
   const next=[...rows.current,...chosen];validateDocumentSelection(next.map(row=>row.file),catalog,next.map(row=>Boolean(row.videoOcr)));
   updateQueue(next);setQueueError('');
  }catch(error){setQueueError(failure(error));}
 };
 const admit=async()=>{
  if(busy.current||!catalog||!page)return;
  busy.current=true;setUploading(true);setQueueError('');const signal=lifetime.current.signal,space=page.space;
  try{
   for(const row of rows.current.filter(row=>row.state==='queued')){
    let submitted=false;
    try{
     validateDocumentSelection([row.file],catalog,[Boolean(row.videoOcr)]);validatePdfOcr(row.file.name,catalog.pdfOcr,row.pdfOcr);
     patch(row.id,{state:'uploading'});
     const original=await api.uploadDocument(row.file,signal);signal.throwIfAborted();
     const expected={space,attachmentId:original.attachment_id,filename:row.file.name,pdfOcr:row.pdfOcr,videoOcr:row.videoOcr};
     submittedFor(api).set(row.id,expected);patch(row.id,{state:'admitting'});submitted=true;
     const value=await api.request<unknown>('/v1/document-jobs',{...requestOptions(signal),method:'POST',body:JSON.stringify({import_id:row.id,attachment_id:original.attachment_id,filename:row.file.name,...(row.pdfOcr?{pdf_ocr:row.pdfOcr}:{}),...(row.videoOcr?{video_ocr:true}:{})})});
     const job=parseDocumentJob(value,space,row.id);
     if(job.attachmentId!==original.attachment_id||job.filename!==row.file.name)throw Error('The admitted job does not match this file.');
     await readDocumentJobRequest(api,job,signal,expected);
     signal.throwIfAborted();patch(row.id,{state:'admitted'});refresh();
    }catch(error){
     if(signal.aborted)return;
     patch(row.id,{state:submitted?'uncertain':'queued',error:failure(error)});setQueueError(submitted?'Admission was not confirmed. Refresh import history and look for this import ID before sending the file again.':failure(error));refresh();break;
    }
   }
  }finally{if(!signal.aborted){busy.current=false;setUploading(false);}}
 };
 const control=async(job:DocumentJob,action:'resume'|'cancel')=>{
  if(controlBusy.current)return;controlBusy.current=true;setActing(job.id);setActionError('');setEvidence(null);
  const signal=lifetime.current.signal;
  try{await controlDocumentJob(api,job,action,signal);if(!signal.aborted)refresh();}
  catch(error){if(!signal.aborted){setActionError(failure(error));refresh();}}
  finally{if(!signal.aborted){controlBusy.current=false;setActing(null);}}
 };
 const verify=async(job:DocumentJob)=>{
  if(controlBusy.current)return;controlBusy.current=true;setActing(job.id);setActionError('');setEvidence(null);
  const signal=lifetime.current.signal;
  try{const value=await verifyDocumentJob(api,job,signal,submittedFor(api).get(job.id));if(!signal.aborted){setEvidence({id:job.id,value});saved.current();refresh();}}
  catch(error){if(!signal.aborted){setActionError(failure(error));refresh();}}
  finally{if(!signal.aborted){controlBusy.current=false;setActing(null);}}
 };
 const ready=queue.filter(row=>row.state==='queued').length;
 return <section className="document-import durable-imports" aria-label="Background document imports">
  <header><div><span className="eyebrow">Retained import history</span><h2>Document imports</h2></div><button className="btn" onClick={()=>setPicker(value=>!value)} disabled={uploading}>{picker?'Hide file picker':'Import documents'}</button></header>
  <p>Admitted imports continue when you leave this page. After a server restart, resume unfinished work explicitly. Opening history does not start imports.</p>
  {picker&&<div className="durable-picker">
   <p>Files waiting to upload stay in this page only. Keep it open until the server acknowledges each import.</p>
   {catalogError&&<p role="alert">{catalogError} Reopen Documents to retry format discovery.</p>}
   {!catalog&&!catalogError&&<p role="status">Checking document formats…</p>}
   {catalog?.videoOcr?.available&&<VideoImportChoice value={videoForNew} disabled={uploading} onChange={setVideoForNew}/>}
   {catalog&&<label className="import-picker">Choose documents<input type="file" multiple disabled={uploading} accept={documentAccept(catalog,videoForNew)} onChange={event=>{choose(event.target.files);event.target.value='';}}/><small>20 files / 100 MiB per selection queue</small></label>}
   {queueError&&<p role="alert">{queueError}</p>}
   <ol className="import-list">{queue.map(row=><li key={row.id} className="import-row">
    <div className="import-row-heading"><strong>{displayFilename(row.file.name)}</strong><span role="status">{{queued:'Ready',uploading:'Uploading original',admitting:'Requesting import',admitted:'Acknowledged by server',uncertain:'Admission unconfirmed'}[row.state]}</span></div>
    <small className="import-digest">Import ID: {row.id}</small>
    {row.error&&<p role="alert">{row.error}</p>}
    {catalog?.pdfOcr?.available&&row.state==='queued'&&row.file.name.toLowerCase().endsWith('.pdf')&&<PdfOcrControls filename={row.file.name} catalog={catalog.pdfOcr} value={row.pdfOcr} disabled={uploading} onChange={pdfOcr=>patch(row.id,{pdfOcr})}/>}
    {catalog?.videoOcr?.available&&row.state==='queued'&&videoFilename(row.file.name)&&<VideoImportChoice label={`Video extraction for ${displayFilename(row.file.name)}`} value={Boolean(row.videoOcr)} disabled={uploading} onChange={videoOcr=>patch(row.id,{videoOcr})}/>}
    {row.videoOcr&&row.state!=='queued'&&<p>Visible text from sampled frames · audio excluded</p>}
    {!uploading&&<button className="btn quiet small" onClick={()=>updateQueue(rows.current.filter(item=>item.id!==row.id))}>Dismiss file selection</button>}
   </li>)}</ol>
   {!!queue.length&&<button className="btn" disabled={uploading||!ready||!page||loading||!!error} onClick={()=>void admit()}>{uploading?'Sending imports…':`Start ${ready} ready ${ready===1?'file':'files'}`}</button>}
  </div>}
  <div className="import-actions"><h3>Saved import jobs</h3><button className="btn quiet small" disabled={loading||!!acting} onClick={refresh}>Refresh import history</button></div>
  {loading&&<p role="status">Loading import history…</p>}
  {error&&<p role="alert">{error} Any previous history below is the last confirmed read.</p>}
  {actionError&&<p role="alert">{actionError}</p>}
  {page&&!page.items.length&&!loading&&<p>No saved import jobs on this page.</p>}
  <ol className="import-list" aria-label="Saved document jobs">{page?.items.map(job=><li key={job.id} className="import-row">
   <div className="import-row-heading"><strong>{displayFilename(job.filename)}</strong><span role="status">{labels[job.status]}</span></div>
   <small className="import-digest">{job.id} · Attempt {job.attempt} of {job.maxAttempts}</small>
   <p>{job.completedSteps.length?`Completed stages: ${job.completedSteps.join(', ')}.`:'No completed stages recorded.'}{job.inflight?` Last active stage: ${job.inflight}.`:''}</p>
   {job.outcomeUnknown&&<p>Work may have partially completed. Resume uses saved checkpoints; status alone does not verify a source.</p>}
   {job.errorClass&&<p>Reported error: {job.errorClass}</p>}
   <div className="import-actions">
    {canResumeDocumentJob(job)&&<button className="btn quiet small" disabled={loading||!!error||!!acting} onClick={()=>void control(job,'resume')}>Resume {displayFilename(job.filename)}</button>}
    {job.activeLocal&&<button className="btn quiet small" disabled={loading||!!error||!!acting} onClick={()=>void control(job,'cancel')}>Cancel {displayFilename(job.filename)}</button>}
    {canVerifyDocumentJob(job)&&<button className="btn quiet small" disabled={loading||!!error||!!acting} onClick={()=>void verify(job)}>Verify source for {displayFilename(job.filename)}</button>}
   </div>
   {acting===job.id&&<p role="status">Reading the server response…</p>}
   {evidence?.id===job.id&&canVerifyDocumentJob(job)&&<ImportEvidence api={api} value={evidence.value}/>}
  </li>)}</ol>
  {page&&<nav className="documents-paging" aria-label="Import history pages"><button className="btn quiet small" disabled={loading||!!acting||cursors.length===1} onClick={()=>{setEvidence(null);setCursors(values=>values.slice(0,-1));}}>Previous imports</button><span>Page {cursors.length}</span><button className="btn quiet small" disabled={loading||!!acting||!page.nextAfter} onClick={()=>{setEvidence(null);setCursors(values=>[...values,page.nextAfter!]);}}>Next imports</button></nav>}
 </section>;
}
