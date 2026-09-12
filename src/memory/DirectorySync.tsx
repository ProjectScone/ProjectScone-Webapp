import {useEffect,useMemo,useRef,useState} from 'react';
import {ApiError,type ApiClient} from '../api';
import {assertSyncIntent,canCancelSync,canResumeSync,controlSync,hasSyncResults,parseSyncCollections,readSyncHistory,readSyncResults,readSyncRun,startSync,syncRequestOptions,type SyncCollection,type SyncHistory,type SyncResults,type SyncRun} from './directory-sync';
import './directory-sync.css';

type Pending={id:string;space:string;collection:SyncCollection;deleteMissing:boolean};
const pendingByConnection=new WeakMap<ApiClient,Pending>();
const failure=(error:unknown)=>error instanceof Error?error.message:'Directory sync request failed.';
const labels:Record<SyncRun['status'],string>={registered:'Waiting for explicit resume',running:'Running',completed:'Completed',partial:'Completed with issues',failed:'Attempt failed',cancelled:'Cancelled',interrupted:'Interrupted'};
export function DirectorySync({api}:{api:ApiClient}){
 const identity=useMemo(()=>crypto.randomUUID(),[api]);
 return <SyncWorkspace key={identity} api={api}/>;
}
function SyncWorkspace({api}:{api:ApiClient}){
 const [collections,setCollections]=useState<SyncCollection[]>([]),[collectionId,setCollectionId]=useState(''),[deleteMissing,setDeleteMissing]=useState(false);
 const [catalogError,setCatalogError]=useState(''),[catalogLoading,setCatalogLoading]=useState(true),[catalogVersion,setCatalogVersion]=useState(0);
 const [cursors,setCursors]=useState<(string|undefined)[]>([undefined]),[version,setVersion]=useState(0),[history,setHistory]=useState<SyncHistory|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[actionError,setActionError]=useState(''),[notice,setNotice]=useState(''),[acting,setActing]=useState(false);
 const [pending,setPending]=useState<Pending|undefined>(()=>pendingByConnection.get(api)),[missing,setMissing]=useState(false),[selected,setSelected]=useState<SyncRun|null>(null);
 const lifetime=useRef(new AbortController()),busy=useRef(false);
 const after=cursors.at(-1),collection=collections.find(value=>value.collection_id===collectionId);
 const refresh=()=>setVersion(value=>value+1);
 useEffect(()=>{const controller=new AbortController();lifetime.current=controller;return()=>controller.abort();},[]);
 useEffect(()=>{
  const controller=new AbortController();setCatalogLoading(true);setCatalogError('');
  void api.request<unknown>('/v1/sync-collections',syncRequestOptions(controller.signal)).then(parseSyncCollections).then(value=>{
   if(controller.signal.aborted)return;setCollections(value);setCollectionId(previous=>value.some(item=>item.collection_id===previous)?previous:value[0]?.collection_id??'');setDeleteMissing(false);setCatalogLoading(false);
  }).catch(error=>{if(!controller.signal.aborted){setCatalogError(failure(error));setCatalogLoading(false);}});
  return()=>controller.abort();
 },[api,catalogVersion]);
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  setLoading(true);setError('');setHistory(null);
  void readSyncHistory(api,controller.signal,after).then(value=>{
   if(controller.signal.aborted)return;setHistory(value);setLoading(false);
   if(value.items.some(run=>run.activeLocal||run.activeElsewhere))timer=setTimeout(refresh,1500);
  }).catch(error=>{if(!controller.signal.aborted){setError(failure(error));setLoading(false);}});
  return()=>{controller.abort();clearTimeout(timer);};
 },[api,after,version]);
 useEffect(()=>{
  if(!pending)return;
  const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);
  return()=>window.removeEventListener('beforeunload',warn);
 },[pending]);
 const perform=async(work:(signal:AbortSignal)=>Promise<void>)=>{
  if(busy.current)return;busy.current=true;setActing(true);setActionError('');setNotice('');
  const signal=lifetime.current.signal;
  try{await work(signal);}catch(error){if(!signal.aborted)setActionError(failure(error));}
  finally{if(!signal.aborted){busy.current=false;setActing(false);refresh();}}
 };
 const acknowledge=(run:SyncRun)=>{
  pendingByConnection.delete(api);setPending(undefined);setMissing(false);
  setNotice(`Run ${run.id} acknowledged. ${run.cancelRequested?'Cancellation was requested; wait until it is idle before resuming.':labels[run.status]+'.'}`);
 };
 const submit=()=>void perform(async signal=>{
  if(!history||!collection||pending)return;
  const request:Pending={id:'sync-'+crypto.randomUUID(),space:history.space,collection,deleteMissing};
  pendingByConnection.set(api,request);setPending(request);setMissing(false);
  acknowledge(await startSync(api,request.space,request.id,request.collection,request.deleteMissing,signal));
 });
 const check=()=>void perform(async signal=>{
  if(!pending)return;
  try{
   const run=await readSyncRun(api,pending.space,pending.id,signal);assertSyncIntent(run,pending.collection,pending.deleteMissing);acknowledge(run);
  }catch(error){if(error instanceof ApiError&&error.status===404){setMissing(true);setNotice('No saved run was found. You can retry this same request ID.');return;}throw error;}
 });
 const retry=()=>void perform(async signal=>{
  if(pending&&missing)acknowledge(await startSync(api,pending.space,pending.id,pending.collection,pending.deleteMissing,signal));
 });
 const control=(run:SyncRun,action:'resume'|'cancel')=>void perform(async signal=>{
  const current=await controlSync(api,run,action,signal);
  setNotice(action==='cancel'?`Cancellation requested for ${run.id}. Work may still be stopping; refresh status before resuming.`:`Resume acknowledged for ${current.id}.`);
 });
 return <section className="directory-sync" aria-label="Local directory synchronization">
  <header><div><span className="eyebrow">Configured local collections</span><h2>Directory sync</h2></div><button className="btn quiet small" disabled={acting||catalogLoading} onClick={()=>setCatalogVersion(value=>value+1)}>Refresh collections</button></header>
  <p>Sync files from a collection configured on this server. Each scan records changes and leaves an inspectable run history. Opening this page does not start or resume scans.</p>
  {catalogLoading&&<p role="status">Loading collections…</p>}
  {catalogError&&<p role="alert">{catalogError}</p>}
  {!catalogLoading&&!catalogError&&!collections.length&&<p>No local directory collections are configured for this space.</p>}
  {!!collections.length&&<div className="sync-start">
   <label>Collection<select value={collectionId} disabled={acting||!!pending||catalogLoading} onChange={event=>{setCollectionId(event.target.value);setDeleteMissing(false);}}>{collections.map(item=><option key={item.collection_id} value={item.collection_id}>{item.label} ({item.collection_id})</option>)}</select></label>
   {collection?.allow_delete_missing&&<label className="sync-removal"><input type="checkbox" checked={deleteMissing} disabled={acting||!!pending} onChange={event=>setDeleteMissing(event.target.checked)}/>Remove indexed sources whose files are missing from this collection</label>}
   <button className="btn" disabled={acting||!!pending||!history||loading||!!error||!!catalogError||catalogLoading||!collection} onClick={submit}>Start directory sync</button>
  </div>}
  {pending&&<div className="sync-pending" role="status"><strong>Admission unconfirmed · {pending.id}</strong><p>Keep this ID until the server confirms the request. Checking is read-only. Retrying uses the same ID and saved removal choice.</p><button className="btn quiet small" disabled={acting} onClick={check}>Check saved run</button>{missing&&<button className="btn quiet small" disabled={acting} onClick={retry}>Retry same run</button>}<button className="btn quiet small" disabled={acting} onClick={()=>{pendingByConnection.delete(api);setPending(undefined);setMissing(false);setNotice('Local request dismissed. Any admitted server work continues; inspect history before starting another scan.');}}>Dismiss local request</button></div>}
  {actionError&&<p role="alert">{actionError}</p>}{notice&&<p role="status">{notice}</p>}
  <div className="sync-history-heading"><h3>Saved sync runs</h3><button className="btn quiet small" disabled={acting||loading} onClick={refresh}>Refresh sync history</button></div>
  {loading&&<p role="status">Loading sync history…</p>}{error&&<p role="alert">{error}</p>}
  {history&&!history.items.length&&<p>No saved sync runs on this page.</p>}
  {history&&<ul className="sync-runs">{history.items.map(run=><li key={run.id} className="sync-run">
   <div className="sync-run-heading"><strong>{collections.find(item=>item.collection_id===run.collectionId)?.label??run.collectionId}</strong><span>{labels[run.status]}{run.activeElsewhere?' · Owned by another server process':run.activeLocal?' · Active on this server':''}</span></div>
   <code>{run.id}</code><p>Attempt {run.attempt} of {run.maxAttempts} · {run.deleteMissing?'Missing-source removal enabled':'Missing sources retained'} · Started {run.createdAt}</p>
   {run.outcomeUnknown&&<p>The previous attempt stopped without a confirmed outcome. Resume explicitly to recover saved progress.</p>}
   {run.cancelRequested&&<p>Cancellation requested{run.activeLocal||run.activeElsewhere?'; waiting for the worker to stop':'; worker is idle'}.</p>}
   {run.errorCode&&<p>Reported issue: {run.errorCode}</p>}
   {hasSyncResults(run)&&<p>{run.sourceCount} source outcomes · {run.issueCount} scan issues · {run.skipped} skipped entries</p>}
   <div className="sync-actions">{hasSyncResults(run)&&<button className="btn quiet small" disabled={acting} onClick={()=>setSelected(run)}>Inspect results for {run.id}</button>}
    {canResumeSync(run,collections)&&<button className="btn quiet small" disabled={acting||!!catalogError||catalogLoading} onClick={()=>control(run,'resume')}>Resume {run.id}</button>}
    {canCancelSync(run)&&<button className="btn quiet small" disabled={acting} onClick={()=>control(run,'cancel')}>Cancel {run.id}</button>}
   </div>
  </li>)}</ul>}
  <nav className="sync-actions" aria-label="Sync history pages"><button className="btn quiet small" disabled={acting||loading||cursors.length===1} onClick={()=>setCursors(values=>values.slice(0,-1))}>Previous runs</button><span>Page {cursors.length} · stable ID order</span><button className="btn quiet small" disabled={acting||loading||!history?.nextAfter} onClick={()=>setCursors(values=>[...values,history?.nextAfter??undefined])}>More runs</button></nav>
  {selected&&<SyncResultView key={selected.id} api={api} run={selected} close={()=>setSelected(null)}/>}
 </section>;
}
function SyncResultView({api,run,close}:{api:ApiClient;run:SyncRun;close:()=>void}){
 const [cursors,setCursors]=useState<(number|undefined)[]>([undefined]),[page,setPage]=useState<SyncResults|null>(null),[error,setError]=useState(''),[version,setVersion]=useState(0);
 const heading=useRef<HTMLHeadingElement>(null),after=cursors.at(-1);
 useEffect(()=>{heading.current?.focus();},[]);
 useEffect(()=>{
  const controller=new AbortController();setPage(null);setError('');
  void readSyncResults(api,run,controller.signal,after).then(value=>{if(!controller.signal.aborted)setPage(value);}).catch(error=>{if(!controller.signal.aborted)setError(failure(error));});
  return()=>controller.abort();
 },[api,run,after,version]);
 return <section className="sync-results" aria-label="Historical sync results"><header><h3 ref={heading} tabIndex={-1}>Results for {run.id}</h3><button className="btn quiet small" onClick={close}>Close sync results</button></header>
  <p>Historical receipts from this scan. Sources may have changed or been removed since then. Use the stored source library to inspect current retained content.</p>
  {error?<div role="alert"><p>{error}</p><button className="btn quiet small" onClick={()=>setVersion(value=>value+1)}>Retry results</button></div>:!page?<p role="status">Loading sync results…</p>:<>
   {!page.items.length&&<p>This scan recorded no source outcomes or issues.</p>}
   <ol start={(after??-1)+2}>{page.items.map(item=><li key={item.index}>{item.source?<><strong>{item.source.path}</strong><p>{item.source.status}{item.source.episodeId!==null?` · Recorded episode #${item.source.episodeId}`:''}{item.source.previousEpisodeId!==null?` · Previous episode #${item.source.previousEpisodeId}`:''}{item.source.code?` · ${item.source.code}`:''}</p></>:item.issue?<><strong>Scan issue · {item.issue.code}</strong><pre>{item.issue.path}</pre>{item.issue.pathEscaped&&<p>Escaped filename diagnostic; this is not a source link.</p>}</>:null}</li>)}</ol>
  </>}
  <nav className="sync-actions" aria-label="Sync result pages"><button className="btn quiet small" disabled={!page||cursors.length===1} onClick={()=>setCursors(values=>values.slice(0,-1))}>Previous results</button><span>Page {cursors.length}</span><button className="btn quiet small" disabled={!page||page.nextAfter===null} onClick={()=>setCursors(values=>[...values,page?.nextAfter??undefined])}>More results</button></nav>
 </section>;
}
