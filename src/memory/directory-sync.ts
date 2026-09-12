import type {ApiClient} from '../api.ts';
import {displayFilename} from './filename-display.ts';

type SyncApi=Pick<ApiClient,'request'>;
export interface SyncCollection {collection_id:string;label:string;allow_delete_missing:boolean;configuration:string}
export interface SyncRun {
 id:string;space:string;collectionId:string;configuration:string;deleteMissing:boolean;
 revision:number;attempt:number;maxAttempts:number;deadlineSeconds:number;status:'registered'|'running'|'completed'|'partial'|'failed'|'cancelled'|'interrupted';
 activeLocal:boolean;activeElsewhere:boolean;outcomeUnknown:boolean;createdAt:string;cancelRequested:boolean;
 errorCode:string|null;sourceCount:number;issueCount:number;outcomeCount:number;skipped:number;
}
export interface SyncHistory {space:string;items:SyncRun[];nextAfter:string|null}
export interface SyncSource {path:string;status:'added'|'updated'|'unchanged'|'deleted'|'absent'|'suppressed'|'failed';episodeId:number|null;previousEpisodeId:number|null;code:string|null}
export interface SyncOutcome {index:number;source:SyncSource|null;issue:{path:string;pathEscaped:boolean;code:string}|null}
export interface SyncResults {items:SyncOutcome[];nextAfter:number|null}
const bad=()=>Error('The server returned inconsistent directory sync details.');
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw bad();return value as Record<string,unknown>;}
function text(value:unknown,max=1024,min=1):string{
 if(typeof value!=='string'||[...value].length<min||[...value].length>max||value.includes('\0')||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(new TextEncoder().encode(value))!==value)throw bad();return value;
}
export function displaySyncPath(value:string):{text:string;escaped:boolean}{
 const text=displayFilename(value);
 return {text,escaped:text!==value};
}
function displayLabel(value:unknown):string{
 if(typeof value!=='string'||[...value].length<1||[...value].length>160)throw bad();
 const text=displayFilename(value);return text!==value?'Escaped label: '+text:value;
}
function integer(value:unknown,max=2147483647,min=0):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw bad();return value;}
function flag(value:unknown):boolean{if(typeof value!=='boolean')throw bad();return value;}
function identifier(value:unknown):string{const result=text(value,128);if(!/^[A-Za-z0-9._:-]+$/.test(result))throw bad();return result;}
function digest(value:unknown,size=64):string{const result=text(value,size);if(!new RegExp(`^[a-f0-9]{${size}}$`).test(result))throw bad();return result;}
function timestamp(value:unknown):string{const result=text(value,64);if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(result)||!Number.isFinite(Date.parse(result)))throw bad();return result;}
function array(value:unknown,max:number):unknown[]{if(!Array.isArray(value)||value.length>max)throw bad();return value;}
const nullable=<T>(value:unknown,parse:(value:unknown)=>T):T|null=>value===null?null:parse(value);
const states=['registered','running','completed','partial','failed','cancelled'] as const;
function choice<T extends string>(value:unknown,choices:readonly T[]):T{if(typeof value!=='string'||!choices.includes(value as T))throw bad();return value as T;}
export const syncRequestOptions=(signal:AbortSignal):RequestInit=>({signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});
export const hasSyncResults=(run:SyncRun)=>run.status==='completed'||run.status==='partial';
export const canCancelSync=(run:SyncRun)=>!hasSyncResults(run)&&!run.activeElsewhere&&!run.cancelRequested;
export const canResumeSync=(run:SyncRun,collections:SyncCollection[])=>!hasSyncResults(run)&&!run.activeLocal&&!run.activeElsewhere&&run.attempt<run.maxAttempts&&collections.some(item=>item.collection_id===run.collectionId&&item.configuration===run.configuration&&(!run.deleteMissing||item.allow_delete_missing));

export function parseSyncCollections(value:unknown):SyncCollection[]{
 const items=array(object(value).items,10000).map(value=>{const row=object(value);return {collection_id:identifier(row.collection_id),label:displayLabel(row.label),configuration:digest(row.configuration),allow_delete_missing:flag(row.allow_delete_missing)};});
 if(new Set(items.map(item=>item.collection_id)).size!==items.length)throw bad();return items;
}
export function parseSyncRun(value:unknown,space:string,id?:string):SyncRun{
 const view=object(value),row=object(view.record),spec=object(row.spec);
 const status=choice(row.status,states),attempt=integer(row.attempt,4),maxAttempts=integer(spec.max_attempts,4,1),revision=integer(row.revision);
 const createdAt=timestamp(row.created_at),started=nullable(row.last_started_at,timestamp),finished=nullable(row.finished_at,timestamp),cancel=nullable(row.cancel_requested_at,timestamp);
 const sourceCount=integer(row.source_count,20000),issueCount=integer(row.issue_count,300000),outcomeCount=integer(row.outcome_count,300000),skipped=integer(row.skipped,Number.MAX_SAFE_INTEGER);
 const terminal=status==='completed'||status==='partial',instance=nullable(row.collection_instance,value=>digest(value,32));
 const activeLocal=flag(view.active_local),activeElsewhere=flag(view.active_elsewhere),outcomeUnknown=flag(view.outcome_unknown),errorCode=nullable(row.error_code,identifier);
 const runId=identifier(row.run_id),runSpace=text(row.space,256);
 if(runSpace!==space||(id!==undefined&&runId!==id)||attempt>maxAttempts||revision<attempt||(attempt===0)!==(started===null)||(status==='registered')!==(attempt===0)
  ||[started,finished,cancel].some(stamp=>stamp!==null&&Date.parse(stamp)<Date.parse(createdAt))||terminal!==(instance!==null)
  ||outcomeCount!==sourceCount+issueCount||(!terminal&&(outcomeCount!==0||skipped!==0))||(status==='completed'&&issueCount!==0)
  ||(['completed','partial','failed','cancelled'].includes(status))!==(finished!==null)||activeLocal&&activeElsewhere
  ||typeof spec.deadline_s!=='number'||!Number.isFinite(spec.deadline_s)||spec.deadline_s<=0||spec.deadline_s>3600)throw bad();
 let observed:SyncRun['status']=status;
 if(!activeLocal&&!activeElsewhere){if(status==='running'||status==='failed'&&errorCode==='sync_interrupted')observed='interrupted';if(cancel!==null)observed='cancelled';}
 if(view.status!==observed||outcomeUnknown!==(attempt>0&&!activeLocal&&!activeElsewhere&&!terminal))throw bad();
 return {id:runId,space:runSpace,collectionId:identifier(spec.collection_id),configuration:digest(spec.configuration),deleteMissing:flag(spec.delete_missing),revision,attempt,maxAttempts,deadlineSeconds:spec.deadline_s,status:observed,activeLocal,activeElsewhere,outcomeUnknown,createdAt,cancelRequested:cancel!==null,errorCode,sourceCount,issueCount,outcomeCount,skipped};
}
export function parseSyncHistory(value:unknown,space:string,after?:string):SyncHistory{
 const row=object(value),items=array(row.items,20).map(value=>parseSyncRun(value,space));
 const nextAfter=nullable(row.next_after,value=>{const result=text(value,129);if(!/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(result)||(after!==undefined&&result<=after))throw bad();return result;});
 if(new Set(items.map(item=>item.id)).size!==items.length||(nextAfter!==null&&!items.length))throw bad();return {space,items,nextAfter};
}
function sourceOutcome(value:unknown):SyncSource{
 const row=object(value),path=text(row.path),status=choice(row.status,['added','updated','unchanged','deleted','absent','suppressed','failed'] as const);
 const episodeId=nullable(row.episode_id,value=>integer(value,Number.MAX_SAFE_INTEGER,1)),previousEpisodeId=nullable(row.previous_episode_id,value=>integer(value,Number.MAX_SAFE_INTEGER,1)),code=nullable(row.code,identifier);
 if(/[\x00-\x1f\x7f\\]/.test(path)||path.split('/').some(part=>['','.','..'].includes(part))
  ||(['added','updated','unchanged','absent'].includes(status)&&episodeId===null)||(['updated','deleted'].includes(status)!==(previousEpisodeId!==null))
  ||(status==='updated'&&episodeId===previousEpisodeId)||(['deleted','failed'].includes(status)&&episodeId!==null)||(status==='failed')!==(code!==null))throw bad();
 return {path,status,episodeId,previousEpisodeId,code};
}
export function parseSyncResults(value:unknown,run:SyncRun,after?:number):SyncResults{
 if(!hasSyncResults(run))throw bad();
 const row=object(value),start=after===undefined?0:integer(after,299999)+1;
 if(row.space!==run.space||row.run_id!==run.id)throw bad();
 if(start>run.outcomeCount)throw bad();
 const items=array(row.items,20).map((value,offset):SyncOutcome=>{
  const row=object(value),index=integer(row.index,299999),source=nullable(row.source,sourceOutcome);
  const issue=nullable(row.issue,value=>{const row=object(value);return {path:text(row.path,49154,0),pathEscaped:flag(row.path_escaped),code:identifier(row.code)};});
  if(run.status==='completed'&&source?.status==='failed')throw bad();
  if(index!==start+offset||(source===null)===(issue===null)||(index<run.sourceCount)!==(source!==null))throw bad();return {index,source,issue};
 });
 const nextAfter=nullable(row.next_after,value=>integer(value,299999));
 const expected=Math.min(20,run.outcomeCount-start);
 if(items.length!==expected||nextAfter!==(start+items.length<run.outcomeCount?items.at(-1)?.index:null))throw bad();
 return {items,nextAfter};
}
export async function readSyncHistory(api:SyncApi,signal:AbortSignal,after?:string):Promise<SyncHistory>{
 const params=new URLSearchParams({limit:'20'});if(after!==undefined)params.set('after',after);
 const [status,page]=await Promise.all([api.request<unknown>('/v1/status',syncRequestOptions(signal)),api.request<unknown>('/v1/sync-runs?'+params,syncRequestOptions(signal))]);
 signal.throwIfAborted();return parseSyncHistory(page,text(object(status).space,256),after);
}
export async function readSyncRun(api:SyncApi,space:string,id:string,signal:AbortSignal):Promise<SyncRun>{
 const result=await api.request<unknown>('/v1/sync-runs/'+encodeURIComponent(identifier(id)),syncRequestOptions(signal));signal.throwIfAborted();return parseSyncRun(result,space,id);
}
export async function startSync(api:SyncApi,space:string,id:string,collection:SyncCollection,deleteMissing:boolean,signal:AbortSignal):Promise<SyncRun>{
 identifier(id);if(deleteMissing&&!collection.allow_delete_missing)throw Error('This collection does not allow removal of missing sources.');
 const result=await api.request<unknown>('/v1/sync-runs',{...syncRequestOptions(signal),method:'POST',body:JSON.stringify({run_id:id,collection_id:collection.collection_id,delete_missing:deleteMissing,expected_configuration:collection.configuration})});signal.throwIfAborted();
 const run=parseSyncRun(result,space,id);assertSyncIntent(run,collection,deleteMissing);return run;
}
export function assertSyncIntent(run:SyncRun,collection:SyncCollection,deleteMissing:boolean):void{
 if(run.collectionId!==collection.collection_id||run.configuration!==collection.configuration||run.deleteMissing!==deleteMissing)throw Error('The saved sync does not match the selected collection configuration and removal choice.');
}
export async function controlSync(api:SyncApi,run:SyncRun,action:'resume'|'cancel',signal:AbortSignal):Promise<SyncRun>{
 const value=await api.request<unknown>(`/v1/sync-runs/${encodeURIComponent(run.id)}/${action}`,{...syncRequestOptions(signal),method:'POST',body:JSON.stringify({expected_revision:run.revision})});signal.throwIfAborted();
 const current=parseSyncRun(value,run.space,run.id);
 if(current.collectionId!==run.collectionId||current.configuration!==run.configuration||current.deleteMissing!==run.deleteMissing||current.revision!==run.revision+1||current.createdAt!==run.createdAt||current.maxAttempts!==run.maxAttempts||current.deadlineSeconds!==run.deadlineSeconds)throw bad();
 if(action==='resume'?(current.attempt!==run.attempt+1||current.status!=='running'||!current.activeLocal||current.cancelRequested):(current.attempt!==run.attempt||!current.cancelRequested))throw bad();return current;
}
export async function readSyncResults(api:SyncApi,run:SyncRun,signal:AbortSignal,after?:number):Promise<SyncResults>{
 const params=new URLSearchParams({limit:'20'});if(after!==undefined)params.set('after',String(after));
 const value=await api.request<unknown>(`/v1/sync-runs/${encodeURIComponent(run.id)}/result?${params}`,syncRequestOptions(signal));signal.throwIfAborted();return parseSyncResults(value,run,after);
}
