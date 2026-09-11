import type {ApiClient} from '../api.ts';
import {documentBinding,parseDocumentEvidence,type DocumentAttachment,type DocumentSource} from './document-evidence.ts';

export const MAX_DOCUMENT_DOWNLOAD_BYTES=100*1024*1024;
export function validateOriginalReference(original:DocumentAttachment):void{
 if(!/^[a-f0-9]{64}$/.test(original.attachment_id)||!Number.isSafeInteger(original.bytes)||original.bytes<1||original.bytes>MAX_DOCUMENT_DOWNLOAD_BYTES
  ||!original.media_type||original.media_type.length>256||/[\r\n]/.test(original.media_type))throw Error('Invalid original reference or download size. Browser downloads support up to 100 MiB.');
}
export function downloadFilename(filename:string):string{
 const basename=(filename.split(/[\\/]/).at(-1)||'').replace(/[\u0000-\u001f\u007f<>:"|?*\u202a-\u202e\u2066-\u2069]/g,'_').trim().replace(/[. ]+$/g,'');
 if(!basename||/^\.+$/.test(basename))return 'original-document';
 const extension=basename.match(/\.[a-zA-Z0-9]{1,16}$/)?.[0]??'',stem=extension?basename.slice(0,-extension.length):basename;
 const encoder=new TextEncoder();let result='';
 for(const char of stem){if(encoder.encode(result+char+extension).length>240)break;result+=char;}
 return result+extension||'original-document';
}
export async function readDocumentOriginal(response:Response,original:DocumentAttachment,signal?:AbortSignal):Promise<Blob>{
 let reader:ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>|undefined;
 const abort=()=>{void reader?.cancel(signal?.reason).catch(()=>{});};
 try{
  validateOriginalReference(original);signal?.throwIfAborted();
  if(!response.ok||response.redirected)throw Error('Original download failed.');
  const mediaType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(mediaType!=='application/octet-stream'&&mediaType!==original.media_type.toLowerCase())throw Error('Original file type does not match its retained record.');
  const length=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');
  if(length!==null&&(!encoding||encoding==='identity')&&(!/^\d+$/.test(length)||Number(length)!==original.bytes))throw Error('Original response size does not match its retained record.');
  reader=response.body?.getReader();if(!reader)throw Error('Original response contains no bytes.');
  signal?.addEventListener('abort',abort,{once:true});signal?.throwIfAborted();
  const chunks:Uint8Array<ArrayBuffer>[]=[];let total=0;
  while(true){const {done,value}=await reader.read();signal?.throwIfAborted();if(done)break;total+=value.byteLength;
   if(total>original.bytes)throw Error('Original response exceeds its retained size.');chunks.push(new Uint8Array(value));
  }
  if(total!==original.bytes)throw Error('Original response size does not match its retained record.');
  const blob=new Blob(chunks,{type:'application/octet-stream'});
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
  signal?.throwIfAborted();if(digest!==original.attachment_id)throw Error('Original digest does not match the saved source.');
  return blob;
 }catch(error){if(reader)await reader.cancel().catch(()=>{});else await response.body?.cancel().catch(()=>{});throw error;}
 finally{signal?.removeEventListener('abort',abort);reader?.releaseLock();}
}


export async function prepareDocumentOriginal(api:Pick<ApiClient,'request'|'documentOriginal'>,source:DocumentSource,episodeId:number,signal:AbortSignal):Promise<{blob:Blob;filename:string;originalName:string}>{
 if(!Number.isSafeInteger(episodeId)||episodeId<1)throw Error('Invalid document source identity.');
 const readSource=async()=>{
  signal.throwIfAborted();
  const value=await api.request<unknown>(`/v1/episodes/${episodeId}`,{signal,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('The source is no longer available. Refresh it.');
  const episode=value as Record<string,unknown>,binding=documentBinding(value);
  const matches=(a:DocumentAttachment,b:DocumentAttachment)=>a.attachment_id===b.attachment_id&&a.bytes===b.bytes&&a.media_type===b.media_type;
  if(episode.episode_id!==episodeId||episode.kind!=='file'||episode.content!==source.content||!binding||binding.format!==source.binding.format
    ||!matches(binding.original,source.binding.original)||!matches(binding.manifest,source.binding.manifest))throw Error('The source changed. Refresh it before downloading.');
 };
 await readSource();
 const evidence=parseDocumentEvidence(await api.request<unknown>(`/v1/episodes/${episodeId}/document`,{signal,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'}),source);
 const blob=await api.documentOriginal(source.binding.original,signal);
 await readSource();signal.throwIfAborted();
 return {blob,filename:downloadFilename(evidence.filename),originalName:evidence.filename};
}
