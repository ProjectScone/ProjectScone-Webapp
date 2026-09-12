import {useEffect,useMemo,useRef,useState} from 'react';
import type {ApiClient} from '../api';
import type {DocumentSource} from './document-evidence';
import {readDocumentEvidence} from './document-evidence-read';
import {prepareMediaPlayback} from './document-media-playback';
import {transcriptTime,type MediaTranscript} from './document-media';
import './document-media.css';
type Props={api:ApiClient;source:DocumentSource;episodeId:number;space:string};
export function SourceDocumentMedia(props:Props){
 const {api,source,episodeId,space}=props,context=useMemo(()=>({api,source,episodeId,space}),[api,source,episodeId,space]);
 const [submitted,setSubmitted]=useState<{context:object}|null>(null),[snapshot,setSnapshot]=useState<{request:object;media?:MediaTranscript;error?:string}|null>(null);
 const request=submitted?.context===context?submitted:null,result=request&&snapshot?.request===request?snapshot:null;
 useEffect(()=>{
  if(!request)return;const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
  void readDocumentEvidence(api,source,episodeId,space,signal).then(data=>{
   if(!data.media)throw Error('This source has no retained transcript timestamps.');
   if(!signal.aborted)setSnapshot({request,media:data.media});
  }).catch(()=>{if(!controller.signal.aborted)setSnapshot({request,error:'Transcript evidence could not be verified. Refresh the source or retry this read.'});});
  return()=>controller.abort();
 },[request]);
 return <details className="document-media"><summary>Inspect transcript and audio</summary><section aria-label="Media transcript evidence">
  <p>Inspect retained text at its source times. Video transcripts describe the first audio stream; frames were not analyzed.</p>
  <div className="document-controls"><button className="btn quiet" onClick={()=>setSubmitted({context})}>{request?'Read transcript again':'Read transcript'}</button>{request&&<button className="btn quiet" onClick={()=>setSubmitted(null)}>{result?'Clear transcript':'Cancel transcript read'}</button>}</div>
  {request&&!result&&<p role="status">Verifying transcript source and timestamps…</p>}{result?.error&&<p role="alert">{result.error}</p>}
  {result?.media&&<TranscriptPlayer {...props} media={result.media}/>}
 </section></details>;
}
function TranscriptPlayer({api,source,episodeId,space,media}:Props&{media:MediaTranscript}){
 const context=useMemo(()=>({api,source,episodeId,space,media}),[api,source,episodeId,space,media]);
 const [submitted,setSubmitted]=useState<{context:object}|null>(null),[snapshot,setSnapshot]=useState<{request:object;url?:string;error?:string}|null>(null);
 const [page,setPage]=useState(0),[ready,setReady]=useState(false),[issue,setIssue]=useState('');
 const player=useRef<HTMLAudioElement>(null),request=submitted?.context===context?submitted:null,result=request&&snapshot?.request===request?snapshot:null;
 useEffect(()=>{
  if(!request)return;const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]);let url='';
  void prepareMediaPlayback(api,source,episodeId,space,media,signal).then(blob=>{
   signal.throwIfAborted();url=URL.createObjectURL(blob);setSnapshot({request,url});
  }).catch(()=>{if(!controller.signal.aborted)setSnapshot({request,error:'Audio could not be verified. Read the transcript again or retry preparation.'});});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[request]);
 const clear=()=>{player.current?.pause();setSubmitted(null);setReady(false);setIssue('');};
 return <div><p>{media.segments.length} transcript segments · {transcriptTime(media.durationSeconds)} decoded audio{media.revision?` · ${media.revision}`:''}</p>
  {media.audio?<><p>Prepare the mono audio used for transcription. Its bytes are checked before playback. Preparation does not run the transcription model.</p><div className="document-controls"><button className="btn quiet" disabled={Boolean(request&&!result)} onClick={()=>{player.current?.pause();setReady(false);setIssue('');setSubmitted({context});}}>Prepare checked audio</button>{request&&<button className="btn quiet" onClick={clear}>{result?'Clear prepared audio':'Cancel audio preparation'}</button>}</div></>:<p>Checked playback is unavailable for this extraction. The retained transcript and original download remain available.</p>}
  {request&&!result&&<p role="status">Preparing and verifying normalized audio…</p>}{result?.error&&<p role="alert">{result.error}</p>}
  {result?.url&&<audio ref={player} controls preload="metadata" src={result.url} aria-label="Verified transcript audio" onLoadedMetadata={()=>{setReady(true);}} onError={()=>{setReady(false);setIssue('This browser could not play the prepared audio. The transcript remains available.');}}/>}
  {issue&&<p role="alert">{issue}</p>}
  <ol start={page*20+1} className="transcript-segments">{media.segments.slice(page*20,(page+1)*20).map(segment=><li key={segment.locator}><span>{transcriptTime(segment.startSeconds)}–{transcriptTime(segment.endSeconds)}</span><pre>{segment.text}</pre><button className="btn quiet small" disabled={!result?.url||!ready} onClick={()=>{if(player.current){player.current.pause();player.current.currentTime=segment.startSeconds;}}}>Seek to {transcriptTime(segment.startSeconds)}</button></li>)}</ol>
  {media.segments.length>20&&<nav aria-label="Transcript pages"><button className="btn quiet" disabled={!page} onClick={()=>setPage(page-1)}>Previous transcript segments</button><span>Page {page+1} of {Math.ceil(media.segments.length/20)}</span><button className="btn quiet" disabled={(page+1)*20>=media.segments.length} onClick={()=>setPage(page+1)}>Next transcript segments</button></nav>}
 </div>;
}
