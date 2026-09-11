import {useEffect,useMemo,useState} from 'react';
import type {ApiClient} from '../api';
import type {Knowledge} from './knowledge';
import {EXPORT_FORMATS,exportRequest,type GraphExportFormat} from './knowledge-export';

type Outcome={url:string;filename:string;bytes:number;truncated:boolean;error?:never}|{error:string;url?:never};
export function KnowledgeExport({api,graph}:{api:ApiClient;graph:Knowledge}){
 const [format,setFormat]=useState<GraphExportFormat>('json');
 const context=useMemo(()=>({api,graph,format}),[api,graph,format]);
 const [submitted,setSubmitted]=useState<{context:object}|null>(null);
 const request=submitted?.context===context?submitted:null;
 const [snapshot,setSnapshot]=useState<{request:object;outcome:Outcome}|null>(null);
 useEffect(()=>{
  if(!request)return;
  const controller=new AbortController();let url='';
  Promise.resolve().then(()=>api.graphExport(exportRequest(graph,format),controller.signal)).then(file=>{
   if(controller.signal.aborted)return;
   url=URL.createObjectURL(file.blob);
   setSnapshot({request,outcome:{url,filename:file.filename,bytes:file.blob.size,truncated:file.truncated}});
  }).catch(error=>{if(!controller.signal.aborted)setSnapshot({request,outcome:{error:error instanceof Error?error.message:'The export could not be prepared.'}});});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[request]);
 const outcome=request&&snapshot?.request===request?snapshot.outcome:null;
 const preparing=Boolean(request&&!outcome);
 return <details className="knowledge-export"><summary>Export knowledge</summary><div className="knowledge-export-body">
  <p>Export the space’s {graph.mode==='all'?'excluded-inclusive':graph.mode} claim view as of {new Date(graph.asOf).toLocaleString()}. Includes entities, relationships, values and supporting claim IDs. Map search, community selection and drawing limits do not narrow this export.</p>
  <div className="knowledge-export-controls"><label>File format<select value={format} onChange={event=>setFormat(event.target.value as GraphExportFormat)}>{Object.entries(EXPORT_FORMATS).map(([key,value])=><option key={key} value={key}>{value.label}</option>)}</select></label><button type="button" className="btn quiet" disabled={preparing} onClick={()=>setSubmitted({context})}>{outcome?'Prepare again':'Prepare export'}</button>{request&&<button type="button" className="btn quiet" onClick={()=>setSubmitted(null)}>{preparing?'Cancel export':'Clear export'}</button>}</div>
  <p>{EXPORT_FORMATS[format].description}</p><p className="muted">Browser downloads are limited to 100 MiB. Coverage metadata travels inside each file.</p>
  {preparing&&<p role="status">Preparing and receiving the export…</p>}
  {outcome?.error&&<p role="alert">{outcome.error}</p>}
  {outcome?.url&&<div className="knowledge-export-ready" role="status"><strong>{outcome.truncated?'Partial export':'Export ready'}</strong><p>{outcome.truncated?'The ledger read was limited. The file’s coverage metadata describes what was left out.':'The export reports a complete ledger read for this claim view.'}</p><a className="btn primary" href={outcome.url} download={outcome.filename}>Save {outcome.filename}</a><span>{outcome.bytes.toLocaleString()} bytes</span></div>}
 </div></details>;
}
