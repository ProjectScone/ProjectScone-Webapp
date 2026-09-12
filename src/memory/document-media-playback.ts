import type {ApiClient} from '../api.ts';
import type {DocumentSource} from './document-evidence.ts';
import type {MediaTranscript} from './document-media.ts';
import {readDocumentEvidence,verifyCurrentDocumentSource} from './document-evidence-read.ts';
import {verifiedSpace} from './source-address.ts';
export async function checkedAudioBlob(blob:Blob,media:MediaTranscript):Promise<Blob>{
 const header=new Uint8Array(await blob.slice(0,44).arrayBuffer());if(header.length!==44||blob.size!==media.audio?.bytes)throw Error('Normalized audio size changed.');
 const data=new DataView(header.buffer),label=(start:number,end:number)=>String.fromCharCode(...header.slice(start,end));
 if(label(0,4)!=='RIFF'||label(8,12)!=='WAVE'||label(12,16)!=='fmt '||label(36,40)!=='data'
  ||data.getUint32(4,true)!==blob.size-8||data.getUint32(16,true)!==16||data.getUint16(20,true)!==1
  ||data.getUint16(22,true)!==1||data.getUint32(24,true)!==16000||data.getUint32(28,true)!==32000
  ||data.getUint16(32,true)!==2||data.getUint16(34,true)!==16||data.getUint32(40,true)!==blob.size-44)throw Error('Normalized audio format changed.');
 return blob.slice(0,blob.size,'audio/wav');
}
export async function prepareMediaPlayback(api:Pick<ApiClient,'request'|'documentAudio'>,source:DocumentSource,episodeId:number,space:string,expected:MediaTranscript,signal:AbortSignal):Promise<Blob>{
 const evidence=await readDocumentEvidence(api,source,episodeId,space,signal),media=evidence.media;
 if(!media?.audio||JSON.stringify(media)!==JSON.stringify(expected))throw Error('Transcript evidence changed. Read it again before playback.');
 const blob=await checkedAudioBlob(await api.documentAudio(episodeId,media.audio,signal),media);
 const connected=verifiedSpace(await api.request<unknown>('/v1/status',{signal,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'}));
 if(connected!==space)throw Error('The connected memory space changed.');
 await verifyCurrentDocumentSource(api,source,episodeId,signal);signal.throwIfAborted();return blob;
}
