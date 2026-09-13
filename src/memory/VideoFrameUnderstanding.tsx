import {useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import type {ApiClient} from '../api';
import {SourceContent} from '../components/SourceContent';
import type {DocumentSource} from './document-evidence';
import {frameTimeLabel,type VideoCatalogue,type VideoFrame} from './document-video';
import {interpretVideoFrame,type VideoInterpretation} from './video-understanding';
import './image-understanding.css';

type Props={api:ApiClient;source:DocumentSource;video:VideoCatalogue;frame:VideoFrame;episodeId:number;space:string};
export function VideoFrameUnderstanding({api,source,video,frame,episodeId,space}:Props){
 const [prompt,setPrompt]=useState('Describe the visible scene in this frame. State any uncertainty.');
 const promptLength=Array.from(prompt).length,validPrompt=Boolean(prompt.trim())&&promptLength<=16000;
 const context=useMemo(()=>({api,source,video,frame,episodeId,space,prompt}),[api,source,video,frame,episodeId,space,prompt]);
 const [submitted,setSubmitted]=useState<{context:object}|null>(null);
 const [snapshot,setSnapshot]=useState<{request:object;result?:VideoInterpretation;error?:string}|null>(null);
 const request=submitted?.context===context?submitted:null,result=request&&snapshot?.request===request?snapshot:null;
 useEffect(()=>{
  if(!request)return;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(150000)]);
  void interpretVideoFrame(api,source,video,frame,episodeId,space,prompt,signal).then(result=>{
   if(!signal.aborted)setSnapshot({request,result});
  }).catch(error=>{if(!controller.signal.aborted)setSnapshot({request,error:error instanceof Error?error.message:'The frame could not be interpreted.'});});
  return()=>controller.abort();
 },[request]);
 return <section className="source-understanding" aria-label="Video frame interpretation">
  <h3>Interpret this frame</h3>
  <p>Ask the selected self-hosted model about frame {frame.ordinal} at {frameTimeLabel(video,frame)}. <Link to="/memory#models">Choose a vision model in Models</Link>.</p>
  <form onSubmit={event=>{event.preventDefault();if(validPrompt)setSubmitted({context});}}>
   <label>Task<textarea aria-label="Frame interpretation task" required maxLength={32000} rows={3} value={prompt} onChange={event=>setPrompt(event.target.value)}/></label>
   <p aria-live="polite">{promptLength.toLocaleString()} / 16,000 characters</p>
   <div><button className="btn primary" type="submit" disabled={Boolean(request&&!result)||!validPrompt}>{request&&!result?'Interpreting frame…':'Interpret frame'}</button>
    {request&&<button className="btn quiet" type="button" onClick={()=>setSubmitted(null)}>{result?'Clear interpretation':'Cancel interpretation'}</button>}</div>
  </form>
  {request&&!result&&<p role="status">Verifying this frame and asking the selected model…</p>}
  {result?.error&&<p role="alert" className="source-understanding-error">{result.error}</p>}
  {result?.result&&<div className="source-understanding-result"><header><strong>Unsaved frame interpretation</strong><span>{result.result.model} · frame {frame.ordinal} · {frameTimeLabel(video,frame)}</span></header>
   <SourceContent text={result.result.text}/><p>Model-generated description of this sampled frame. It may be mistaken. This result has not been saved.</p>
  </div>}
 </section>;
}
