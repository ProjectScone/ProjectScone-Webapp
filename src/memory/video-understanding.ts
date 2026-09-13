import type {ApiClient} from '../api.ts';
import type {DocumentSource} from './document-evidence.ts';
import type {VideoCatalogue,VideoFrame} from './document-video.ts';
import {readVideoCatalogue} from './document-video-read.ts';

export interface VideoInterpretation {text:string;model:string}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid frame interpretation response.');
 return value as Record<string,unknown>;
}
function text(value:unknown,max:number):string{
 if(typeof value!=='string'||!value.trim()||value.length>max*2||Array.from(value).length>max||value.includes('\0')||decoder.decode(encoder.encode(value))!==value)throw Error('Invalid frame interpretation text.');
 return value;
}
export function parseVideoUnderstanding(value:unknown,source:DocumentSource,video:VideoCatalogue,frame:VideoFrame,episodeId:number,space:string):VideoInterpretation{
 const body=object(value),observed=object(body.frame),result=object(body.understanding);
 if(!Number.isSafeInteger(episodeId)||episodeId<1||body.schema_version!==1||body.space!==space||body.episode_id!==String(episodeId)
  ||body.persisted!==false||body.original_sha256!==source.binding.original.attachment_id||body.manifest_sha256!==source.binding.manifest.attachment_id
  ||observed.ordinal!==frame.ordinal||observed.presentation_timestamp!==frame.presentationTimestamp||observed.time_base!==video.timeBase
  ||observed.png_sha256!==frame.sha256||observed.width!==frame.width||observed.height!==frame.height
  ||result.origin!=='model_generated'||result.attachment_id!==frame.sha256||result.media_type!=='image/png'
  ||result.width!==frame.width||result.height!==frame.height||result.source!==`video:episode:${episodeId}/stream:${video.streamIndex}/frame:${frame.ordinal}`){
  throw Error('The interpretation does not match the selected video source and frame.');
 }
 return {text:text(result.text,64000),model:text(result.model,256)};
}
export async function interpretVideoFrame(api:Pick<ApiClient,'request'>,source:DocumentSource,video:VideoCatalogue,frame:VideoFrame,episodeId:number,space:string,prompt:string,signal:AbortSignal):Promise<VideoInterpretation>{
 text(prompt,16000);signal.throwIfAborted();
 const current=await readVideoCatalogue(api,source,episodeId,space,signal);
 if(JSON.stringify(current)!==JSON.stringify(video)||!current.frames.some(item=>JSON.stringify(item)===JSON.stringify(frame)))throw Error('Video evidence changed. Read the frame evidence again.');
 signal.throwIfAborted();
 const response=await api.request<unknown>(`/v1/episodes/${episodeId}/document/video/frames/${frame.ordinal}/understand`,{
  method:'POST',body:JSON.stringify({prompt}),signal,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',
 });
 const interpretation=parseVideoUnderstanding(response,source,video,frame,episodeId,space);
 const final=await readVideoCatalogue(api,source,episodeId,space,signal);
 if(JSON.stringify(final)!==JSON.stringify(current))throw Error('Video evidence changed during interpretation.');
 signal.throwIfAborted();return interpretation;
}
