import {parseDocumentEvidence,type DocumentEvidence,type DocumentSource} from './document-evidence.ts';

export interface VideoRegion {text:string;start:number;end:number;box:[number,number,number,number];score:number|null}
export interface VideoFrame {
 ordinal:number;presentationTimestamp:string;requestedSeconds:number[];width:number;height:number;
 sha256:string;bytes:number;ocrEngine:string;empty:boolean;text:string;regions:VideoRegion[];
}
export interface VideoCatalogue {
 document:DocumentEvidence;sourceSha256:string;decoderRevision:string;policyRevision:string;modelRevision:string;
 streamIndex:number;timeBase:string;startTimestamp:string;durationTicks:string;
 intervalSeconds:number;decodedFrames:number;unavailableRequests:number;frames:VideoFrame[];
}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function record(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid video evidence record.');
 return value as Record<string,unknown>;
}
function text(value:unknown,max:number):string{
 if(typeof value!=='string'||!value.length||value.length>max||decoder.decode(encoder.encode(value))!==value)throw Error('Invalid video evidence text.');
 return value;
}
function characters(value:unknown,max:number):string{
 const result=text(value,max*2);if(Array.from(result).length>max)throw Error('Video text exceeds its character limit.');return result;
}
function integer(value:unknown,max:number,min=0):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw Error('Invalid video evidence count.');
 return value;
}
function list(value:unknown,max:number):unknown[]{
 if(!Array.isArray(value)||value.length>max)throw Error('Video evidence exceeds its list limit.');return value;
}
function hash(value:unknown):string{
 const result=text(value,64);if(!/^[a-f0-9]{64}$/.test(result))throw Error('Invalid video evidence hash.');return result;
}
function timestamp(value:unknown,min=-(1n<<63n)):string{
 const result=text(value,20);
 if(!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(result))throw Error('Video timestamp must be canonical decimal text.');
 const parsed=BigInt(result);if(parsed<min||parsed>=(1n<<63n))throw Error('Video timestamp exceeds int64.');return result;
}
function timeBase(value:unknown):[string,bigint,bigint]{
 const result=text(value,21);
 if(!/^[1-9][0-9]{0,9}\/[1-9][0-9]{0,9}$/.test(result))throw Error('Invalid video time base.');
 const [numerator,denominator]=result.split('/').map(BigInt);return [result,numerator,denominator];
}
function regions(value:unknown,content:string):VideoRegion[]{
 const encoded=encoder.encode(content);let previous=0;
 const result=list(value,20000).map(item=>{
  const v=record(item),start=integer(v.start,encoded.length),end=integer(v.end,encoded.length),label=characters(v.text,100000);
  if(v.coordinate_space!=='normalized_displayed_frame_top_left'||start<previous||end<=start
   ||decoder.decode(encoded.subarray(start,end))!==label||decoder.decode(encoded.subarray(previous,start)).trim())throw Error('Video region does not match its UTF-8 source span.');
  previous=end;
  const box=list(v.box,4);
  if(box.length!==4||!box.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1))throw Error('Invalid video OCR box.');
  const rectangle=box as [number,number,number,number];
  if(rectangle[0]>=rectangle[2]||rectangle[1]>=rectangle[3])throw Error('Video OCR box is empty.');
  const score=v.score??null;
  if(score!==null&&(typeof score!=='number'||!Number.isFinite(score)||score<0||score>1))throw Error('Invalid OCR recognizer score.');
  return {text:label,start,end,box:[...rectangle] as [number,number,number,number],score};
 });
 if(decoder.decode(encoded.subarray(previous)).trim())throw Error('Video OCR regions omit recognized text.');
 return result;
}

export function parseVideoCatalogue(value:unknown,source:DocumentSource,episodeId:number,space:string):VideoCatalogue{
 const envelope=record(value);
 if(!Number.isSafeInteger(episodeId)||episodeId<1||envelope.schema_version!==1||envelope.timestamp_encoding!=='decimal-string'
  ||envelope.episode_id!==String(episodeId)||envelope.space!==space)throw Error('Video catalogue does not match this source and space.');
 const evidence=record(envelope.evidence),document=parseDocumentEvidence(evidence,source);
 if(document.parser!=='video-frame-ocr'||document.pdfOcr||document.media||document.cells.size)throw Error('Source is not sampled video OCR.');
 const v=record(evidence.video),sourceSha256=hash(v.source_sha256),policy=record(v.policy);
 if(sourceSha256!==source.binding.original.attachment_id)throw Error('Video catalogue has a different original.');
 const intervalSeconds=integer(policy.interval_seconds,120,1),maxFrames=integer(policy.max_frames,256,1);
 const maxDuration=integer(policy.max_duration_seconds,600,1),maxPixels=integer(policy.max_pixels,20000000,1);
 const maxFrameBytes=integer(policy.max_frame_bytes,10000000,1),maxTotalBytes=integer(policy.max_total_bytes,64000000,1);
 const [base,numerator,denominator]=timeBase(v.time_base),startTimestamp=timestamp(v.start_timestamp),durationTicks=timestamp(v.duration_ticks,1n);
 const duration=BigInt(durationTicks)*numerator,start=BigInt(startTimestamp);
 if(duration>BigInt(maxDuration)*denominator)throw Error('Video duration exceeds the retained sampling limit.');
 const streamIndex=integer(v.stream_index,100000),decodedFrames=integer(v.decoded_frames,100000,1),unavailableRequests=integer(v.unavailable_requests,600);
 const requests:number[]=[];
 for(let second=0;BigInt(second)*denominator<duration;second+=intervalSeconds)requests.push(second);
 let covered=0,totalBytes=0,lastOrdinal=-1,lastTimestamp:bigint|undefined;
 const frames=list(v.frames,maxFrames).map(item=>{
  const f=record(item),ordinal=integer(f.ordinal,decodedFrames-1),pts=timestamp(f.presentation_timestamp),position=BigInt(pts);
  const requestedSeconds=list(f.requested_seconds,600).map(n=>integer(n,599));
  const width=integer(f.width,100000,1),height=integer(f.height,100000,1),bytes=integer(f.png_bytes,maxFrameBytes,1);
  if(typeof f.empty!=='boolean'||!requestedSeconds.length||ordinal<=lastOrdinal||(lastTimestamp!==undefined&&position<=lastTimestamp)
   ||width*height>maxPixels)throw Error('Inconsistent video frame inventory.');
  for(const second of requestedSeconds){if(second!==requests[covered++])throw Error('Video sampling requests are missing or reordered.');}
  const relative=(position-start)*numerator;
  if(relative<BigInt(requestedSeconds.at(-1)!)*denominator||relative>=duration)throw Error('Video frame falls outside its sampling interval.');
  totalBytes+=bytes;lastOrdinal=ordinal;lastTimestamp=position;
  return {ordinal,presentationTimestamp:pts,requestedSeconds,width,height,bytes,sha256:hash(f.png_sha256),ocrEngine:characters(f.ocr_engine,96),
   empty:f.empty,text:'',regions:[] as VideoRegion[]};
 });
 if(!frames.length||totalBytes>maxTotalBytes||covered+unavailableRequests!==requests.length)throw Error('Video sampling coverage is inconsistent.');
 const byOrdinal=new Map(frames.map(frame=>[String(frame.ordinal),frame])),seen=new Set<string>();let regionCount=0;
 for(const item of list(evidence.segments,20000)){
  const segment=record(item),metadata=record(segment.metadata),ordinal=text(metadata.video_frame_ordinal,5),frame=byOrdinal.get(ordinal);
  if(!frame||frame.empty||seen.has(ordinal)||segment.locator!==`video:stream:${streamIndex}/frame:${ordinal}`
   ||metadata.extraction!=='ocr'||metadata.engine!==frame.ocrEngine)throw Error('Video text does not match its retained frame.');
  frame.text=text(segment.text,2000000);frame.regions=regions(segment.regions,frame.text);
  regionCount+=frame.regions.length;
  if(!frame.regions.length||regionCount>20000)throw Error('Video OCR region count is invalid.');seen.add(ordinal);
 }
 if(frames.some(frame=>!frame.empty&&!seen.has(String(frame.ordinal))))throw Error('Video frame text is missing.');
 const modelRevision=text(v.model_revision,128);
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(modelRevision))throw Error('Invalid video OCR model revision.');
 return {document,sourceSha256,decoderRevision:hash(v.decoder_revision),policyRevision:characters(v.policy_revision,96),modelRevision,
  streamIndex,timeBase:base,startTimestamp,durationTicks,intervalSeconds,decodedFrames,unavailableRequests,frames};
}

export function frameTimeLabel(video:VideoCatalogue,frame:VideoFrame):string{
 const [,numerator,denominator]=timeBase(video.timeBase);
 const ticks=(BigInt(frame.presentationTimestamp)-BigInt(video.startTimestamp))*numerator;
 const whole=ticks/denominator,remainder=ticks%denominator;
 if(!remainder)return `${whole} s`;
 let a=remainder,b=denominator;while(b){const rest=a%b;a=b;b=rest;}
 return `${whole} + ${remainder/a}/${denominator/a} s`;
}
