import {useEffect,useMemo,useState} from 'react';
import type {ApiClient} from '../api';
import type {DocumentSource} from './document-evidence';
import {frameTimeLabel,type VideoCatalogue,type VideoFrame} from './document-video';
import {prepareVideoFrame,readVideoCatalogue} from './document-video-read';
export {VIDEO_FORMATS} from './document-video-import';
import './document-video.css';
import {VideoFrameUnderstanding} from './VideoFrameUnderstanding';

type Props={api:ApiClient;source:DocumentSource;episodeId:number;space:string;understanding?:boolean};
export function SourceDocumentVideo(props:Props){
 const {api,source,episodeId,space}=props;
 const context=useMemo(()=>({api,source,episodeId,space}),[api,source,episodeId,space]);
 const [submitted,setSubmitted]=useState<{context:object}|null>(null);
 const [snapshot,setSnapshot]=useState<{request:object;video?:VideoCatalogue;error?:string}|null>(null);
 const request=submitted?.context===context?submitted:null,result=request&&snapshot?.request===request?snapshot:null;
 useEffect(()=>{
  if(!request)return;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
  void readVideoCatalogue(api,source,episodeId,space,signal).then(video=>{
   if(!signal.aborted)setSnapshot({request,video});
  }).catch(()=>{if(!controller.signal.aborted)setSnapshot({request,error:'Sampled frame evidence could not be verified. This source may use speech transcription, or the server may not support frame evidence. Refresh the source or retry.'});});
  return()=>controller.abort();
 },[request]);
 return <details className="document-video"><summary>Inspect sampled video frames</summary><section aria-label="Video frame evidence">
  <p>Read the retained sampling record, then prepare an individual frame. Frame preparation checks pixels without running OCR again.</p>
  <div className="document-controls"><button className="btn quiet" onClick={()=>setSubmitted({context})}>{request?'Read frame evidence again':'Read frame evidence'}</button>
   {request&&<button className="btn quiet" onClick={()=>setSubmitted(null)}>{result?'Clear frame evidence':'Cancel frame evidence read'}</button>}</div>
  {request&&!result&&<p role="status">Verifying the video source and sampling record…</p>}
  {result?.error&&<p role="alert">{result.error}</p>}
  {result?.video&&<FrameCatalogue {...props} video={result.video}/>}
 </section></details>;
}
function FrameCatalogue(props:Props&{video:VideoCatalogue}){
 const {video}=props;
 const [selection,setSelection]=useState<{video:VideoCatalogue;index:number}|null>(null);
 const index=selection?.video===video?selection.index:0,frame=video.frames[index];
 const empty=video.frames.filter(frame=>frame.empty).length;
 return <div><p>{video.frames.length} sampled frames · {empty} returned no text · requested every {video.intervalSeconds} seconds.</p>
  {empty===video.frames.length&&<p>No text recognized in sampled frames. The original video and frame evidence are retained; this source has no searchable text.</p>}
  <p>Unsampled moments were not examined. Empty OCR does not establish that a frame contains no visible text. Audio was not transcribed in this extraction.</p>
  {!!video.unavailableRequests&&<p>{video.unavailableRequests} requested times had no retained frame.</p>}
  <label className="video-frame-picker">Sampled frame<select aria-label="Sampled video frame" value={index} onChange={event=>setSelection({video,index:Number(event.target.value)})}>
   {video.frames.map((frame,index)=><option key={frame.ordinal} value={index}>Frame {frame.ordinal} · {frameTimeLabel(video,frame)}{frame.empty?' · No recognized text':''}</option>)}
  </select></label>
  <FrameEvidence {...props} frame={frame}/>
 </div>;
}
function FrameEvidence({api,source,episodeId,space,video,frame,understanding}:Props&{video:VideoCatalogue;frame:VideoFrame}){
 const context=useMemo(()=>({api,source,episodeId,space,video,frame}),[api,source,episodeId,space,video,frame]);
 const [submitted,setSubmitted]=useState<{context:object}|null>(null);
 const [snapshot,setSnapshot]=useState<{request:object;url?:string;error?:string}|null>(null);
 const [regionSelection,setRegionSelection]=useState<{context:object;page:number;index:number|null}|null>(null);
 const regions=regionSelection?.context===context?regionSelection:{page:0,index:null};
 const request=submitted?.context===context?submitted:null,result=request&&snapshot?.request===request?snapshot:null;
 useEffect(()=>{
  if(!request)return;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]);let url='';
  void prepareVideoFrame(api,source,episodeId,space,video,frame.ordinal,signal).then(blob=>{
   signal.throwIfAborted();url=URL.createObjectURL(blob);setSnapshot({request,url});
  }).catch(()=>{if(!controller.signal.aborted)setSnapshot({request,error:'Frame pixels could not be verified. Read the frame evidence again or retry preparation.'});});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[request]);
 const box=regions.index===null?null:frame.regions[regions.index]?.box;
 return <section aria-label={`Frame ${frame.ordinal} evidence`}>
  <h3>Frame {frame.ordinal} · {frameTimeLabel(video,frame)}</h3>
  <p className="video-clock">Original timestamp: {frame.presentationTimestamp} ticks · time base {video.timeBase} · {frame.width} × {frame.height}</p>
  <div className="document-controls"><button className="btn quiet" disabled={Boolean(request&&!result)} onClick={()=>setSubmitted({context})}>Prepare checked frame</button>
   {request&&<button className="btn quiet" onClick={()=>setSubmitted(null)}>{result?'Clear prepared frame':'Cancel frame preparation'}</button>}</div>
  {request&&!result&&<p role="status">Preparing and verifying frame pixels…</p>}{result?.error&&<p role="alert">{result.error}</p>}
  {result?.url&&<div className="video-frame-image"><img src={result.url} alt={`Verified video frame ${frame.ordinal} at ${frameTimeLabel(video,frame)}`} onError={()=>{if(request)setSnapshot({request,error:'The browser could not display this verified PNG. The retained text remains available.'});}}/>
   {box&&<span className="video-region-box" aria-hidden="true" style={{left:`${box[0]*100}%`,top:`${box[1]*100}%`,width:`${(box[2]-box[0])*100}%`,height:`${(box[3]-box[1])*100}%`}}/>}</div>}
  {understanding&&result?.url&&<VideoFrameUnderstanding api={api} source={source} episodeId={episodeId} space={space} video={video} frame={frame}/>}
  {frame.empty?<p>No text was recognized in this sampled frame.</p>:<><p>{frame.regions.length} recognized regions · {frame.ocrEngine}. Select a region to highlight its recorded box.</p>
   <ol className="video-regions" start={regions.page*40+1}>{frame.regions.slice(regions.page*40,(regions.page+1)*40).map((region,index)=><li key={regions.page*40+index}><button className="btn quiet" aria-pressed={regions.index===regions.page*40+index} onClick={()=>setRegionSelection({context,page:regions.page,index:regions.page*40+index})}>{region.text}</button><small>UTF-8 bytes {region.start}–{region.end}{region.score===null?'':` · recognizer score ${region.score.toFixed(2)}`}</small></li>)}</ol>
   {frame.regions.length>40&&<nav aria-label="Video OCR region pages"><button className="btn quiet" disabled={!regions.page} onClick={()=>setRegionSelection({context,page:regions.page-1,index:null})}>Previous regions</button><span>Page {regions.page+1} of {Math.ceil(frame.regions.length/40)}</span><button className="btn quiet" disabled={(regions.page+1)*40>=frame.regions.length} onClick={()=>setRegionSelection({context,page:regions.page+1,index:null})}>Next regions</button></nav>}
  </>}
 </section>;
}
