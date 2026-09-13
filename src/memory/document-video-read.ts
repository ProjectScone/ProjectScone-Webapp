import type {ApiClient} from '../api.ts';
import type {DocumentSource} from './document-evidence.ts';
import {parseVideoCatalogue,type VideoCatalogue} from './document-video.ts';
import {verifiedSpace} from './source-address.ts';

function readOptions(signal:AbortSignal){
 return {signal,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'} as const;
}
async function checkSpace(api:Pick<ApiClient,'request'>,space:string,signal:AbortSignal):Promise<void>{
 signal.throwIfAborted();
 if(verifiedSpace(await api.request<unknown>('/v1/status',readOptions(signal)))!==space)throw Error('The connected memory space changed.');
}
export async function readVideoCatalogue(api:Pick<ApiClient,'request'>,source:DocumentSource,episodeId:number,space:string,signal:AbortSignal):Promise<VideoCatalogue>{
 if(!Number.isSafeInteger(episodeId)||episodeId<1)throw Error('Invalid video source identity.');
 await checkSpace(api,space,signal);
 const result=parseVideoCatalogue(await api.request<unknown>(`/v1/episodes/${episodeId}/document/video/catalogue`,readOptions(signal)),source,episodeId,space);
 signal.throwIfAborted();return result;
}
export async function prepareVideoFrame(api:Pick<ApiClient,'request'|'documentVideoFrame'>,source:DocumentSource,episodeId:number,space:string,expected:VideoCatalogue,ordinal:number,signal:AbortSignal):Promise<Blob>{
 const current=await readVideoCatalogue(api,source,episodeId,space,signal);
 if(JSON.stringify(current)!==JSON.stringify(expected))throw Error('Video evidence changed. Read the catalogue again.');
 const frame=current.frames.find(item=>item.ordinal===ordinal);
 if(!frame)throw Error('This frame was not retained in the sampling record.');
 const blob=await api.documentVideoFrame(episodeId,{...frame,timeBase:current.timeBase},signal);
 const final=await readVideoCatalogue(api,source,episodeId,space,signal);
 if(JSON.stringify(final)!==JSON.stringify(current))throw Error('Video evidence changed during frame preparation.');
 signal.throwIfAborted();return blob;
}
