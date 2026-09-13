import type {ApiClient,ImageAttachment} from '../api.ts';
import {parseReceipt,verifyDocumentImport,type VerifiedImport} from './document-import.ts';
import {parsePdfOcrSelection,samePdfOcr,type PdfOcrSelection} from './document-ocr.ts';
import {videoFilename,videoOcrChoice} from './document-video-import.ts';

type JobApi=Pick<ApiClient,'request'>;
const states=['registered','created','running','interrupted','cancelled','completed','failed','sources_invalid','verification_unavailable','deadline','outcome_unknown','retry_not_allowed','unavailable'] as const;
export interface DocumentJob {
 id:string;space:string;filename:string;attachmentId:string;createdAt:string;
 attempt:number;maxAttempts:number;revision:number;status:typeof states[number];
 activeLocal:boolean;completedSteps:string[];inflight:string|null;outcomeUnknown:boolean;errorClass:string|null;
}
export interface DocumentJobPage {items:DocumentJob[];nextAfter:string|null;space:string}
export interface DocumentJobRequest {pdfOcr?:PdfOcrSelection;videoOcr?:boolean}
export interface DocumentJobSubmission {space:string;filename:string;attachmentId:string;pdfOcr?:PdfOcrSelection;videoOcr?:boolean}
const bad=()=>Error('The server returned inconsistent document job details.');
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw bad();return value as Record<string,unknown>;}
function text(value:unknown,max=1024):string{if(typeof value!=='string'||!value.length||value.length>max||value.includes('\0')||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(new TextEncoder().encode(value))!==value)throw bad();return value;}
function integer(value:unknown,min=0,max=2147483647):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw bad();return value;}
function flag(value:unknown):boolean{if(typeof value!=='boolean')throw bad();return value;}
function identifier(value:unknown):string{const result=text(value,128);if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(result))throw bad();return result;}
function digest(value:unknown):string{const result=text(value,64);if(!/^[a-f0-9]{64}$/.test(result))throw bad();return result;}
const options=(signal:AbortSignal):RequestInit=>({signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});

export function parseDocumentJob(value:unknown,space:string,expectedId?:string):DocumentJob{
 const raw=record(value),id=identifier(raw.import_id),status=raw.status;
 if(raw.space!==space||!space.trim()||(expectedId!==undefined&&id!==expectedId)||!states.some(state=>state===status))throw bad();
 const attempt=integer(raw.attempt),revision=integer(raw.revision),maxAttempts=integer(raw.max_attempts,1,4);
 const completedSteps=raw.completed_steps;
 if(attempt>maxAttempts||revision<attempt||!Array.isArray(completedSteps)||completedSteps.length>2||completedSteps.some((step,i)=>step!==['extract','index'][i]))throw bad();
 const inflight=raw.inflight===null?null:text(raw.inflight,32);
 if(inflight!==null&&!['extract','index'].includes(inflight))throw bad();
 if(status==='completed'&&(completedSteps.length!==2||inflight!==null))throw bad();
 const createdAt=text(raw.created_at,64);
 if(!/^\d{4}-\d\d-\d\dT/.test(createdAt)||!Number.isFinite(Date.parse(createdAt)))throw bad();
 return {id,space,filename:text(raw.filename),attachmentId:digest(raw.attachment_id),createdAt,attempt,maxAttempts,revision,status:status as DocumentJob['status'],
  completedSteps:completedSteps as string[],inflight,activeLocal:flag(raw.active_local),outcomeUnknown:flag(raw.outcome_unknown),errorClass:raw.error_class===null?null:text(raw.error_class,128)};
}
export function parseDocumentJobPage(value:unknown,space:string):DocumentJobPage{
 const raw=record(value);if(!Array.isArray(raw.items)||raw.items.length>20)throw bad();
 const items=raw.items.map(item=>parseDocumentJob(item,space));
 const nextAfter=raw.next_after===null?null:text(raw.next_after,256);
 if(new Set(items.map(item=>item.id)).size!==items.length||(nextAfter!==null&&!items.length))throw bad();
 return {items,nextAfter,space};
}
export function parseDocumentJobRequest(value:unknown,job:DocumentJob,submitted?:DocumentJobSubmission):DocumentJobRequest{
 const raw=record(value),spec=record(raw.spec);
 if(raw.space!==job.space||raw.import_id!==job.id||spec.attachment_id!==job.attachmentId||spec.filename!==job.filename||spec.max_attempts!==job.maxAttempts)throw bad();
 identifier(spec.parser_revision);
 const pdfOcr=spec.pdf_ocr==null?undefined:parsePdfOcrSelection(spec.pdf_ocr);
 const videoOcr=videoOcrChoice(spec.video_ocr);
 if(videoOcr&&(!videoFilename(job.filename)||pdfOcr))throw bad();
 if(pdfOcr&&!job.filename.toLowerCase().endsWith('.pdf'))throw bad();
 if(submitted&&(submitted.space!==job.space||submitted.filename!==job.filename||submitted.attachmentId!==job.attachmentId||!samePdfOcr(pdfOcr,submitted.pdfOcr)||videoOcr!==videoOcrChoice(submitted.videoOcr)))throw Error('The saved import does not match the submitted file and OCR choice.');
 return {pdfOcr,videoOcr};
}
export function canVerifyDocumentJob(job:DocumentJob):boolean{
 return !job.activeLocal&&['completed','verification_unavailable'].includes(job.status)&&job.completedSteps.length===2&&job.inflight===null;
}
export function canResumeDocumentJob(job:DocumentJob):boolean{
 return !canVerifyDocumentJob(job)&&!job.activeLocal&&job.attempt<job.maxAttempts&&!['completed','sources_invalid','unavailable'].includes(job.status);
}
export async function readDocumentJobs(api:JobApi,signal:AbortSignal,after?:string):Promise<DocumentJobPage>{
 const params=new URLSearchParams({limit:'20'});if(after)params.set('after',after);
 const [status,page]=await Promise.all([api.request<unknown>('/v1/status',options(signal)),api.request<unknown>('/v1/document-jobs?'+params,options(signal))]);
 signal.throwIfAborted();return parseDocumentJobPage(page,text(record(status).space,256));
}
export async function controlDocumentJob(api:JobApi,job:DocumentJob,action:'resume'|'cancel',signal:AbortSignal):Promise<DocumentJob>{
 const result=await api.request<unknown>(`/v1/document-jobs/${encodeURIComponent(job.id)}/${action}`,{...options(signal),method:'POST',body:JSON.stringify({expected_revision:job.revision})});
 signal.throwIfAborted();return parseDocumentJob(result,job.space,job.id);
}
export async function readDocumentJobRequest(api:JobApi,job:DocumentJob,signal:AbortSignal,submitted?:DocumentJobSubmission):Promise<DocumentJobRequest>{
 return parseDocumentJobRequest(await api.request<unknown>('/v1/document-jobs/'+encodeURIComponent(job.id)+'/request',options(signal)),job,submitted);
}
export async function verifyDocumentJob(api:ApiClient,job:DocumentJob,signal:AbortSignal,submitted?:DocumentJobSubmission):Promise<VerifiedImport>{
 const prefix='/v1/document-jobs/'+encodeURIComponent(job.id);
 const request=await readDocumentJobRequest(api,job,signal,submitted);
 const raw=record(await api.request<unknown>(prefix+'/result',options(signal)));
 if(raw.space!==job.space||raw.import_id!==job.id)throw bad();
 const attached=record(raw.original);
 const original:ImageAttachment={attachment_id:job.attachmentId,bytes:integer(attached.bytes,1,25*1024*1024),media_type:text(attached.media_type,256)};
 const receipt=parseReceipt(raw,original,job.filename,request.pdfOcr,request.videoOcr);
 return verifyDocumentImport(api,receipt,signal,job.space);
}
