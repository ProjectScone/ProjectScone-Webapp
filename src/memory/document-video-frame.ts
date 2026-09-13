import {readDocumentOriginal} from './document-download.ts';

export interface VideoFrameReference {
 ordinal:number;presentationTimestamp:string;timeBase:string;width:number;height:number;sha256:string;bytes:number;
}
export function validateVideoFrameReference(frame:VideoFrameReference):void{
 const count=(value:number,max:number,min=1)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
 if(!count(frame.ordinal,99999,0)||!count(frame.width,100000)||!count(frame.height,100000)
  ||frame.width*frame.height>20000000||!count(frame.bytes,10000000)||!/^[a-f0-9]{64}$/.test(frame.sha256)
  ||typeof frame.presentationTimestamp!=='string'||frame.presentationTimestamp.length>20
  ||!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(frame.presentationTimestamp)
  ||BigInt(frame.presentationTimestamp)<-(1n<<63n)||BigInt(frame.presentationTimestamp)>=(1n<<63n)
  ||typeof frame.timeBase!=='string'||!/^[1-9][0-9]{0,9}\/[1-9][0-9]{0,9}$/.test(frame.timeBase))throw Error('Invalid retained video frame reference.');
}
export async function readVideoFrame(response:Response,frame:VideoFrameReference,signal:AbortSignal):Promise<Blob>{
 try{
  validateVideoFrameReference(frame);signal.throwIfAborted();
  if(response.headers.get('content-type')?.split(';')[0].trim()!=='image/png'
   ||response.headers.get('x-scone-video-frame-sha256')!==frame.sha256
   ||response.headers.get('x-scone-video-frame-ordinal')!==String(frame.ordinal)
   ||response.headers.get('x-scone-video-pts')!==frame.presentationTimestamp
   ||response.headers.get('x-scone-video-time-base')!==frame.timeBase)throw Error('Video pixels do not match the retained frame citation.');
 }catch(error){await response.body?.cancel().catch(()=>{});throw error;}
 const blob=await readDocumentOriginal(response,{attachment_id:frame.sha256,bytes:frame.bytes,media_type:'image/png'},signal);
 const header=new Uint8Array(await blob.slice(0,33).arrayBuffer());signal.throwIfAborted();
 if(header.length!==33||![137,80,78,71,13,10,26,10].every((byte,index)=>header[index]===byte))throw Error('Video frame is not a PNG.');
 const data=new DataView(header.buffer);
 if(data.getUint32(8)!==13||data.getUint32(12)!==0x49484452||data.getUint32(16)!==frame.width||data.getUint32(20)!==frame.height)
  throw Error('Video frame dimensions do not match the retained citation.');
 return blob.slice(0,blob.size,'image/png');
}
