import {ApiError,type ApiClient} from '../api.ts';
import {parseCapabilities} from '../capabilities.ts';
import {verifiedSpace} from './source-address.ts';
import {documentDisplayName,parseRetainedSource} from './source-inventory.ts';

type Client=Pick<ApiClient,'request'>;
export interface RemovalAddress {episodeId:number;space:string}
export interface ForgetReceipt {
 episode_id:number;chunks:number;attachments_released:string[];attachments_kept:string[];
 facts_citing:number[];links_citing:number[];forgotten_at:string|null;
}
export type ForgetStatus=
 |{state:'present';episode_id:number}
 |{state:'pending';episode_id:number;requested_at:string;impact:ForgetReceipt}
 |{state:'forgotten';episode_id:number;forgotten_at:string};
export interface RemovalView {status:ForgetStatus;title:string;impact:ForgetReceipt|null}
const options=(signal:AbortSignal):RequestInit=>({signal,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});
function record(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid removal response.');
 return value as Record<string,unknown>;
}
function identity(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>0;}
function timestamp(value:unknown):value is string{
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))return false;
 if(Number(value.slice(0,4))<1||Number(value.slice(11,13))>23)return false;
 const calendar=new Date(value.slice(0,10)+'T00:00:00.000Z');
 return Number.isFinite(calendar.getTime())&&calendar.toISOString().slice(0,10)===value.slice(0,10);
}
function identities(value:unknown):number[]{
 if(!Array.isArray(value)||!value.every(identity)||new Set(value).size!==value.length)throw Error('Invalid cited claim or link identities.');
 return value;
}
function attachments(value:unknown):string[]{
 if(!Array.isArray(value)||!value.every((id:unknown)=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id))||new Set(value).size!==value.length)throw Error('Invalid attachment identities.');
 return value as string[];
}
export function parseForgetReceipt(value:unknown,episodeId:number,completed:boolean):ForgetReceipt {
 const data=record(value);
 if(!identity(episodeId)||data.episode_id!==episodeId||!Number.isSafeInteger(data.chunks)||(data.chunks as number)<0)throw Error('Removal receipt does not match this source.');
 if(completed?data.forgotten!==episodeId||!timestamp(data.forgotten_at):data.forgotten_at!=null)throw Error('Invalid removal completion receipt.');
 const released=attachments(data.attachments_released),kept=attachments(data.attachments_kept),releasedIds=new Set(released);
 if(kept.some(id=>releasedIds.has(id)))throw Error('Attachment cannot be both released and retained.');
 return {episode_id:episodeId,chunks:data.chunks as number,attachments_released:released,attachments_kept:kept,
  facts_citing:identities(data.facts_citing),links_citing:identities(data.links_citing),forgotten_at:completed?data.forgotten_at as string:null};
}
export function parseForgetStatus(value:unknown,episodeId:number):ForgetStatus {
 const data=record(value);
 if(!identity(episodeId)||data.episode_id!==episodeId)throw Error('Removal status does not match this source.');
 if(data.state==='present'&&data.impact==null&&data.requested_at==null&&data.forgotten_at==null)return {state:'present',episode_id:episodeId};
 if(data.state==='pending'&&timestamp(data.requested_at)&&data.forgotten_at==null)return {state:'pending',episode_id:episodeId,requested_at:data.requested_at,impact:parseForgetReceipt(data.impact,episodeId,false)};
 if(data.state==='forgotten'&&timestamp(data.forgotten_at)&&data.requested_at==null&&data.impact==null)return {state:'forgotten',episode_id:episodeId,forgotten_at:data.forgotten_at};
 throw Error('Invalid removal status.');
}
export async function readRemoval(api:Client,address:RemovalAddress,signal:AbortSignal):Promise<RemovalView>{
 const actual=verifiedSpace(await api.request<unknown>('/v1/status',options(signal)));
 if(actual!==address.space)throw Error(`This link belongs to a different space: “${address.space}”. The connected space is “${actual}”.`);
 const caps=parseCapabilities(await api.request<unknown>('/v1/capabilities',options(signal)));
 if(!caps.features['episodes.forget']||!caps.features['episodes.read'])throw Error('Source removal is unavailable on this server.');
 const base=`/v1/episodes/${address.episodeId}`,title=`Source episode #${address.episodeId}`;
 const readStatus=async()=>parseForgetStatus(await api.request<unknown>(base+'/forget-status',options(signal)),address.episodeId);
 let status=await readStatus();
 if(status.state!=='present')return {status,title,impact:status.state==='pending'?status.impact:null};
 try{
  const source=record(await api.request<unknown>(base,options(signal)));parseRetainedSource(source,address.episodeId);
  const metadata=source.metadata&&typeof source.metadata==='object'&&!Array.isArray(source.metadata)?source.metadata as Record<string,unknown>:{};
  const label=documentDisplayName(metadata.document_filename)||(typeof source.source==='string'&&source.source?source.source:title);
  const impact=parseForgetReceipt(await api.request<unknown>(base+'/impact',options(signal)),address.episodeId,false);
  status=await readStatus();
  return {status,title:label,impact:status.state==='present'?impact:status.state==='pending'?status.impact:null};
 }catch(error){
  if(!(error instanceof ApiError)||![404,410].includes(error.status))throw error;
  status=await readStatus();
  if(status.state==='present')throw error;
  return {status,title,impact:status.state==='pending'?status.impact:null};
 }
}
export async function removeSource(api:Client,episodeId:number,signal:AbortSignal):Promise<ForgetReceipt>{
 if(!identity(episodeId))throw Error('Invalid source identity.');
 return parseForgetReceipt(await api.request<unknown>(`/v1/episodes/${episodeId}`,{...options(signal),method:'DELETE'}),episodeId,true);
}
