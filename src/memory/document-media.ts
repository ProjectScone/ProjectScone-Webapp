import type {DocumentAttachment} from './document-evidence.ts';
export const MEDIA_FORMATS=new Set(['wav','mp3','flac','ogg','oga','opus','aac','m4a','mp4','m4v','mov','webm','mkv','avi','mpeg','mpg','mpegts']);
export interface TranscriptSegment {locator:string;text:string;startSeconds:number;endSeconds:number}
export interface TranscriptWindowing {maxSeconds:number;coverage?:{windows:number;emptyWindows:number}}
export interface MediaTranscript {durationSeconds:number;revision?:string;segments:TranscriptSegment[];audio?:DocumentAttachment;windowing?:TranscriptWindowing}
const bad=()=>Error('Media transcript evidence is inconsistent.');
const numberPattern='-?[0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?';
const numeric=new RegExp('^'+numberPattern+'$'),locatorPattern=new RegExp('^audio:0/segment:([1-9][0-9]*)/seconds:('+numberPattern+')-('+numberPattern+')$');
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw bad();return value as Record<string,unknown>;}
function seconds(value:unknown):number{if(typeof value!=='string'||value.length>40||!numeric.test(value))throw bad();const n=Number(value);if(!Number.isFinite(n)||n<0||n>600+1/16000)throw bad();return n;}
function windowing(metadata:Record<string,unknown>,duration:number,segments:number):TranscriptWindowing|undefined{
 const keys=['transcription_windows','chunk_seconds','transcription_window_count','transcription_empty_windows'];
 if(keys.every(key=>metadata[key]===undefined))return undefined;
 const count=(value:unknown,max:number,min=0)=>{
  if(typeof value!=='string'||!/^(?:0|[1-9][0-9]{0,3})$/.test(value))throw bad();
  const n=Number(value);if(n<min||n>max)throw bad();return n;
 };
 if(metadata.transcription_windows!=='quiet-audio-windows-v1')throw bad();
 const maxSeconds=count(metadata.chunk_seconds,120,1);
 if(metadata.transcription_window_count===undefined&&metadata.transcription_empty_windows===undefined)return {maxSeconds,coverage:undefined};
 const windows=count(metadata.transcription_window_count,1000,1),emptyWindows=count(metadata.transcription_empty_windows,windows-1);
 if(windows<Math.ceil(duration/maxSeconds)||windows-emptyWindows>segments)throw bad();
 return {maxSeconds,coverage:{windows,emptyWindows}};
}
export function parseMediaTranscript(format:string,parser:string,metadata:Record<string,unknown>,values:unknown[]):MediaTranscript|undefined{
 if(metadata.extraction!=='audio-only'&&parser!=='media-transcription')return undefined;
 if(!MEDIA_FORMATS.has(format)||parser!=='media-transcription'||metadata.extraction!=='audio-only'||metadata.sample_rate!=='16000'||!values.length)throw bad();
 const durationSeconds=seconds(metadata.duration_seconds);if(durationSeconds<=0||durationSeconds>600)throw bad();
 const revision=metadata.transcriber_revision;if(revision!==undefined&&(typeof revision!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(revision)))throw bad();
 let previous=0;
 const segments=values.map((value,index)=>{
  const v=record(value),m=record(v.metadata),match=typeof v.locator==='string'?locatorPattern.exec(v.locator):null;
  if(!match||Number(match[1])!==index+1||typeof v.text!=='string'||!v.text.trim()||m.extraction!=='transcription'||m.audio_stream!=='0')throw bad();
  const startSeconds=seconds(m.start_seconds),endSeconds=seconds(m.end_seconds);
  if(Number(match[2])!==startSeconds||Number(match[3])!==endSeconds||startSeconds<previous||endSeconds<=startSeconds||endSeconds>durationSeconds+1/16000)throw bad();
  previous=startSeconds;return {locator:v.locator as string,text:v.text,startSeconds,endSeconds};
 });
 let audio:DocumentAttachment|undefined;
 if(metadata.audio_wav_sha256!==undefined||metadata.audio_wav_bytes!==undefined){
  const hash=metadata.audio_wav_sha256,rawSize=metadata.audio_wav_bytes;
  if(typeof hash!=='string'||! /^[a-f0-9]{64}$/.test(hash)||typeof rawSize!=='string'||! /^[1-9][0-9]{0,7}$/.test(rawSize))throw bad();
  const bytes=Number(rawSize);if(bytes<46||bytes>19200044||(bytes-44)%2!==0||Math.abs((bytes-44)/32000-durationSeconds)>1e-8)throw bad();
  if(revision!==undefined)audio={attachment_id:hash,bytes,media_type:'audio/wav'};
 }
 return {durationSeconds,revision,segments,audio,windowing:windowing(metadata,durationSeconds,segments.length)};
}
export function transcriptTime(value:number):string{
 const millis=Math.round(value*1000),minutes=Math.floor(millis/60000),seconds=((millis%60000)/1000).toFixed(3).padStart(6,'0');return `${minutes}:${seconds}`;
}
