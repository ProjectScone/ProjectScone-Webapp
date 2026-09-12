import type {ApiClient} from '../api.ts';
import {parseCapabilities} from '../capabilities.ts';
import {verifiedSpace} from './source-address.ts';
import {documentBinding,parseDocumentEvidence,type DocumentEvidence,type DocumentSource} from './document-evidence.ts';

export async function readDocumentEvidence(api:Pick<ApiClient,'request'>,source:DocumentSource,episodeId:number,space:string,signal:AbortSignal):Promise<DocumentEvidence>{
 signal.throwIfAborted();
 const options={signal,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'} as const;
 const connected=verifiedSpace(await api.request<unknown>('/v1/status',options));
 if(connected!==space)throw Error('The connected memory space changed.');
 const capabilities=parseCapabilities(await api.request<unknown>('/v1/capabilities',options));
 if(!capabilities.features['documents.provenance'])throw Error('Document evidence is unavailable on this server.');
 const data=parseDocumentEvidence(await api.request<unknown>(`/v1/episodes/${episodeId}/document`,options),source);
 await verifyCurrentDocumentSource(api,source,episodeId,signal);
 return data;
}

export async function verifyCurrentDocumentSource(api:Pick<ApiClient,'request'>,source:DocumentSource,episodeId:number,signal:AbortSignal):Promise<void>{
 signal.throwIfAborted();
 const options={signal,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'} as const;
 const current=await api.request<unknown>(`/v1/episodes/${episodeId}`,options);
 if(!current||typeof current!=='object'||Array.isArray(current))throw Error('The retained source is unavailable.');
 const record=current as Record<string,unknown>,binding=documentBinding(current);
 if(record.episode_id!==episodeId||record.kind!=='file'||record.content!==source.content||!binding||JSON.stringify(binding)!==JSON.stringify(source.binding))throw Error('The retained source changed during evidence verification.');
 signal.throwIfAborted();
}
