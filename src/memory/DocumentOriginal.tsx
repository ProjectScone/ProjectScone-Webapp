import {useEffect,useMemo,useState} from 'react';
import type {ApiClient} from '../api';
import {type DocumentSource} from './document-evidence';
import {prepareDocumentOriginal} from './document-download';
import './document-original.css';

type Result={url:string;filename:string;bytes:number;originalName:string}|{error:string};
export function DocumentOriginal({api,source,episodeId}:{api:ApiClient;source:DocumentSource;episodeId:number}){
 const context=useMemo(()=>({api,source,episodeId}),[api,source,episodeId]);
 const [submitted,setSubmitted]=useState<{context:object}|null>(null),[snapshot,setSnapshot]=useState<{request:object;result:Result}|null>(null);
 const request=submitted?.context===context?submitted:null;
 const result=request&&snapshot?.request===request?snapshot.result:null,preparing=Boolean(request&&!result);
 useEffect(()=>{
  if(!request)return;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]);let url='';
  void (async()=>{
   try{
    const {blob,filename,originalName}=await prepareDocumentOriginal(api,source,episodeId,signal);signal.throwIfAborted();
    url=URL.createObjectURL(blob);setSnapshot({request,result:{url,filename,originalName,bytes:blob.size}});
   }catch(error){if(!controller.signal.aborted)setSnapshot({request,result:{error:error instanceof Error?error.message:'The original file could not be verified.'}});}
  })();
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[request]);
 return <section className="document-original" aria-label="Original document download"><div><span className="eyebrow">Retained original file</span><h2>Download the original</h2><p>Get the uploaded file with its original bytes. Scone checks its saved source, attachment identity and SHA-256 before making the download available.</p></div>
  <div className="document-original-actions"><button className="btn quiet" disabled={preparing} onClick={()=>setSubmitted({context})}>{result?'Prepare original again':'Prepare original file'}</button>{request&&<button className="btn quiet" onClick={()=>setSubmitted(null)}>{preparing?'Cancel original download':'Clear original download'}</button>}</div>
  {preparing&&<p role="status">Verifying and receiving the original file…</p>}
  {result&&'error' in result&&<p role="alert">{result.error}</p>}
  {result&&'url' in result&&<div className="document-original-ready" role="status"><strong>{result.originalName}</strong><p>{result.bytes.toLocaleString()} verified bytes{result.filename!==result.originalName?` · Saves as ${result.filename}`:''}</p><a className="btn primary" href={result.url} download={result.filename}>Save original file</a></div>}
  <small>Up to 100 MiB. This downloads the retained file; extracted text and table evidence stay available below. Clearing the download or leaving this source releases the prepared file.</small>
 </section>;
}
