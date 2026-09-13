import {displayFilename} from './filename-display.ts';
import {parseVideoOcrCatalog,validateVideoOcr,videoOcrChoice,type VideoOcrCatalog} from './document-video-import.ts';
import {readVideoCatalogue} from './document-video-read.ts';
import {verifiedSpace} from './source-address.ts';
import {verifyCurrentDocumentSource} from './document-evidence-read.ts';
import {ApiError,type ApiClient,type ImageAttachment} from '../api.ts';
import {documentBinding,parseDocumentEvidence,type DocumentEvidence,type DocumentSource} from './document-evidence.ts';
import {parsePdfOcrCatalog,parsePdfOcrSelection,samePdfOcr,validatePdfOcr,type PdfOcrCatalog,type PdfOcrSelection} from './document-ocr.ts';

export const MAX_QUEUE_FILES=20,MAX_QUEUE_BYTES=100*1024*1024;
const MAX_FILE_BYTES=25*1024*1024;
export interface DocumentFormat {available:boolean;parser:string;requires?:string}
export interface DocumentFormats {maxInputBytes:number;formats:Map<string,DocumentFormat>;pdfOcr?:PdfOcrCatalog;videoOcr?:VideoOcrCatalog}
export interface ImportReceipt {episodeId:number;deduplicated:boolean;original:ImageAttachment;manifest:ImageAttachment;filename:string;format:string;segments:number;pdfOcr?:PdfOcrSelection;videoOcr?:boolean}
export interface VerifiedImport {space:string;receipt:ImportReceipt;source:DocumentSource;evidence:DocumentEvidence}
export type ImportPhase='uploading'|'indexing'|'verifying';
export type ImportOutcome={status:'verified';verified:VerifiedImport}|{status:'unverified';receipt:ImportReceipt;error:string}|{status:'uncertain'|'failed';error:string};
export type ImportApi=Pick<ApiClient,'request'|'uploadDocument'>;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid document response.');return value as Record<string,unknown>;}
function text(value:unknown,max:number):string{if(typeof value!=='string'||!value.length||value.length>max||decoder.decode(encoder.encode(value))!==value)throw Error('Invalid document response text.');return value;}
function count(value:unknown,max=Number.MAX_SAFE_INTEGER):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>max)throw Error('Invalid document response count.');return value;}
function attachment(value:unknown):ImageAttachment{const v=record(value),id=text(v.attachment_id,64);if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid document attachment identity.');return {attachment_id:id,media_type:text(v.media_type,256),bytes:count(v.bytes,MAX_FILE_BYTES)};}
function sameAttachment(actual:ImageAttachment,expected:ImageAttachment){if(actual.attachment_id!==expected.attachment_id||actual.bytes!==expected.bytes||actual.media_type!==expected.media_type)throw Error('Document receipt does not match its attachment.');}
const message=(error:unknown)=>error instanceof Error?error.message:'Document request failed.';

export function parseDocumentFormats(value:unknown):DocumentFormats{
 const v=record(value),maxInputBytes=count(v.max_input_bytes,MAX_FILE_BYTES),entries=Object.entries(record(v.formats));
 if(entries.length>256)throw Error('Document format list exceeds its limit.');
 const formats=new Map<string,DocumentFormat>();
 for(const [extension,value] of entries){
  if(!/^\.[a-z0-9]{1,16}$/.test(extension))throw Error('Invalid document extension.');
  const v=record(value);if(typeof v.available!=='boolean')throw Error('Invalid document availability.');
  formats.set(extension,{available:v.available,parser:text(v.parser,128),requires:v.requires===undefined?undefined:text(v.requires,1024)});
 }
 return {maxInputBytes,formats,pdfOcr:v.pdf_ocr===undefined?undefined:parsePdfOcrCatalog(v.pdf_ocr),videoOcr:v.video_ocr===undefined?undefined:parseVideoOcrCatalog(v.video_ocr)};
}
export function validateDocumentSelection(files:readonly File[],catalog:DocumentFormats,videoSelections:readonly boolean[]=[]):void{
 if(videoSelections.length&&videoSelections.length!==files.length)throw Error('Each file needs its own extraction choice.');
 if(files.length>MAX_QUEUE_FILES)throw Error(`Keep at most ${MAX_QUEUE_FILES} files in this queue.`);
 if(files.reduce((total,file)=>total+file.size,0)>MAX_QUEUE_BYTES)throw Error('The queue exceeds its 100 MiB byte limit.');
 for(const [index,file] of files.entries()){
  const encoded=encoder.encode(file.name);
  if(!file.name||encoded.length>1024||decoder.decode(encoded)!==file.name||/[\u0000-\u001f\u007f]/.test(file.name))throw Error('Invalid document filename.');
  if(!file.size||file.size>catalog.maxInputBytes)throw Error(`${displayFilename(file.name)} is empty or exceeds the per-file byte limit.`);
  const extension=file.name.slice(file.name.lastIndexOf('.')).toLowerCase(),format=catalog.formats.get(extension);
  const video=videoOcrChoice(videoSelections[index]);validateVideoOcr(file.name,catalog.videoOcr,video);
  if(video)continue;
  if(!format)throw Error(`${displayFilename(file.name)}: this format is not supported by the connected server.`);
  if(!format.available)throw Error(`${displayFilename(file.name)}: its parser is unavailable on the connected server.`);
 }
}
export function parseReceipt(value:unknown,original:ImageAttachment,filename:string,expectedOcr?:PdfOcrSelection,expectedVideo=false):ImportReceipt{
 const v=record(value),added=record(v.added),savedOriginal=attachment(v.original),manifest=attachment(v.manifest);
 sameAttachment(savedOriginal,original);
 if(v.filename!==filename||typeof added.deduplicated!=='boolean'||manifest.media_type!=='application/json')throw Error('Document receipt does not match this import.');
 const pdfOcr=v.pdf_ocr===undefined?undefined:parsePdfOcrSelection(v.pdf_ocr);
 const videoOcr=videoOcrChoice(v.video_ocr);
 if(videoOcr!==expectedVideo||(videoOcr&&pdfOcr))throw Error('Document receipt does not match the selected video extraction mode.');
 if(!samePdfOcr(pdfOcr,expectedOcr))throw Error('Document receipt does not match the selected PDF OCR settings.');
 return {episodeId:count(added.episode_id),deduplicated:added.deduplicated,original:savedOriginal,manifest,filename,format:text(v.format,64),segments:count(v.segments,20000),pdfOcr,videoOcr};
}
export async function verifyDocumentImport(api:ImportApi,receipt:ImportReceipt,signal:AbortSignal,expectedSpace?:string):Promise<VerifiedImport>{
 const active=AbortSignal.any([signal,AbortSignal.timeout(60000)]);active.throwIfAborted();
 const space=verifiedSpace(await api.request<unknown>('/v1/status',{signal:active,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'}));
 if(expectedSpace!==undefined&&space!==expectedSpace)throw Error('The connected memory space changed.');
 const episode=record(await api.request<unknown>(`/v1/episodes/${receipt.episodeId}`,{signal:active,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'}));
 if(episode.episode_id!==receipt.episodeId||episode.kind!=='file'||typeof episode.content!=='string'||encoder.encode(episode.content).length>2000000)throw Error('Saved source does not match this document.');
 const binding=documentBinding(episode);if(!binding||binding.format!==receipt.format)throw Error('Saved document attachments are missing or changed.');
 sameAttachment(binding.original,receipt.original);sameAttachment(binding.manifest,receipt.manifest);
 const source={content:episode.content,binding};
 const evidence=receipt.videoOcr?(await readVideoCatalogue(api,source,receipt.episodeId,space,active)).document:
  parseDocumentEvidence(await api.request<unknown>(`/v1/episodes/${receipt.episodeId}/document`,{signal:active,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'}),source);
 if((evidence.parser==='video-frame-ocr')!==Boolean(receipt.videoOcr))throw Error('Saved extraction does not match the selected video mode.');
 if(evidence.filename!==receipt.filename||evidence.segments.length!==receipt.segments)throw Error('Saved extraction does not match this document receipt.');
 if(!samePdfOcr(evidence.pdfOcr,receipt.pdfOcr))throw Error('Saved extraction does not match the selected PDF OCR settings.');
 await verifyCurrentDocumentSource(api,source,receipt.episodeId,active,receipt.videoOcr?space:undefined);
 active.throwIfAborted();return {space,receipt,source,evidence};
}
export async function importDocument(api:ImportApi,file:File,catalog:DocumentFormats,signal:AbortSignal,phase:(phase:ImportPhase)=>void,pdfOcr?:PdfOcrSelection,videoOcr=false):Promise<ImportOutcome>{
 let indexing=false,receipt:ImportReceipt|undefined;
 try{
  const selected=pdfOcr===undefined?undefined:parsePdfOcrSelection(pdfOcr);
  validateDocumentSelection([file],catalog,[videoOcr]);validatePdfOcr(file.name,catalog.pdfOcr,selected);
  if(videoOcr&&selected)throw Error('Choose either video OCR or PDF OCR for this file.');
  signal.throwIfAborted();phase('uploading');
  const original=await api.uploadDocument(file,signal);signal.throwIfAborted();phase('indexing');indexing=true;
  const result=await api.request<unknown>('/v1/documents',{method:'POST',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',body:JSON.stringify({attachment_id:original.attachment_id,filename:file.name,...(selected?{pdf_ocr:selected}:{}),...(videoOcr?{video_ocr:true}:{})}),signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});
  receipt=parseReceipt(result,original,file.name,selected,videoOcr);signal.throwIfAborted();phase('verifying');
  return {status:'verified',verified:await verifyDocumentImport(api,receipt,signal)};
 }catch(error){
  if(receipt)return {status:'unverified',receipt,error:message(error)};
  // Authorization runs before indexing. Other indexing failures can follow a partial write.
  const denied=error instanceof ApiError&&(error.status===401||error.status===403);
  return {status:indexing&&!denied?'uncertain':'failed',error:message(error)};
 }
}
