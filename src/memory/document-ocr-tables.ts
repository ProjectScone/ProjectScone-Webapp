import type {ApiClient} from '../api.ts';
import {parseCapabilities} from '../capabilities.ts';
import {verifiedSpace} from './source-address.ts';
import {documentBinding,type DocumentSource} from './document-evidence.ts';
import type {OcrPage} from './document-ocr-evidence.ts';

export interface OcrTableCell {row:number;column:number;text:string;box:number[];regions:number[]}
export interface OcrTable {rows:number;columns:number;cells:OcrTableCell[]}
export interface OcrTableInspection {tables:OcrTable[];unassigned:number[];exportText:string}
export interface OcrTableAddress {space:string;episodeId:number;source:DocumentSource;page:OcrPage}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid table analysis.');return value as Record<string,unknown>;}
function list(value:unknown,max:number):unknown[]{if(!Array.isArray(value)||value.length>max)throw Error('Table analysis exceeds its limits.');return value;}
function count(value:unknown,max:number,min=0):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw Error('Invalid table analysis count.');return value;}
export async function pageDigest(text:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function parseOcrTables(value:unknown,address:OcrTableAddress):Promise<OcrTableInspection>{
 const v=record(value),{page,source}=address,l=record(v.layout),n=page.regions.length;
 if(page.extraction!=='ocr'||n>5000||v.space!==address.space||v.episode_id!==address.episodeId||v.page!==page.number||v.original_sha256!==source.binding.original.attachment_id||v.manifest_sha256!==source.binding.manifest.attachment_id||v.page_text_sha256!==await pageDigest(page.text))throw Error('Table analysis does not match the retained source.');
 if(l.schema_version!==1||l.strategy!=='aligned-rows-v1'||l.origin!=='geometry_inferred'||l.region_count!==n)throw Error('Unsupported table analysis.');
 const used=new Set<number>(),tables:OcrTable[]=[];
 for(const raw of list(l.tables,64)){
  const table=record(raw),rows=count(table.rows,1000,3),columns=count(table.columns,12,2),cells:OcrTableCell[]=[];
  const values=list(table.cells,5000);if(values.length!==rows*columns)throw Error('Incomplete table grid.');
  for(const [index,raw] of values.entries()){
   const c=record(raw),row=count(c.row,rows-1),column=count(c.column,columns-1);
   if(row!==Math.floor(index/columns)||column!==index%columns)throw Error('Table cells are out of order.');
   const regions=list(c.regions,5000).map(value=>count(value,n-1));if(!regions.length)throw Error('Table cell has no source regions.');
   for(const index of regions){if(used.has(index))throw Error('Repeated OCR region in table analysis.');used.add(index);}
   const observed=regions.map(i=>page.regions[i]),text=observed.map(r=>r.text).join(' ');
   const box=[Math.min(...observed.map(r=>r.box[0])),Math.min(...observed.map(r=>r.box[1])),Math.max(...observed.map(r=>r.box[2])),Math.max(...observed.map(r=>r.box[3]))];
   if(c.text!==text||JSON.stringify(c.box)!==JSON.stringify(box))throw Error('Table cell does not match its observed regions.');
   if(column&&cells.at(-1)!.box[2]>box[0])throw Error('Table columns overlap.');
   cells.push({row,column,text,box,regions});
  }
  for(let row=1;row<rows;row++){
   const previous=cells.slice((row-1)*columns,row*columns),current=cells.slice(row*columns,(row+1)*columns);
   if(Math.max(...previous.map(c=>c.box[3]))>Math.min(...current.map(c=>c.box[1])))throw Error('Table rows overlap.');
  }
  for(let column=0;column<columns-1;column++){
   const left=cells.filter(c=>c.column===column),right=cells.filter(c=>c.column===column+1);
   if(Math.max(...left.map(c=>c.box[2]))>=Math.min(...right.map(c=>c.box[0])))throw Error('Table columns have no common separating gap.');
  }
  tables.push({rows,columns,cells});
 }
 const unassigned=list(l.unassigned,5000).map(value=>count(value,n-1));let previous=-1;
 for(const index of unassigned){if(index<=previous||used.has(index))throw Error('Invalid unassigned OCR regions.');used.add(index);previous=index;}
 if(used.size!==n)throw Error('Table analysis omits OCR regions.');
 const notes=['geometry_only',...(unassigned.length?['unassigned_regions']:[]),...(!tables.length?['no_aligned_grid']:[])];
 if(JSON.stringify(l.notes)!==JSON.stringify(notes))throw Error('Table coverage notes do not match its result.');
 const exportText=JSON.stringify({schema_version:1,space:address.space,episode_id:address.episodeId,page:page.number,
  original_sha256:v.original_sha256,manifest_sha256:v.manifest_sha256,page_text_sha256:v.page_text_sha256,
  strategy:l.strategy,origin:l.origin,notes,tables,unassigned,page_text:page.text,
  regions:page.regions.map(r=>({text:r.text,start:r.start,end:r.end,box:r.box,provider_index:r.providerIndex}))},null,2);
 return {tables,unassigned,exportText};
}
export async function readOcrTables(api:ApiClient,address:OcrTableAddress,signal:AbortSignal):Promise<OcrTableInspection>{
 const options={signal,cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'} as const;
 if(verifiedSpace(await api.request<unknown>('/v1/status',options))!==address.space)throw Error('The connected memory space changed.');
 const capabilities=parseCapabilities(await api.request<unknown>('/v1/capabilities',options));
 if(!capabilities.features['documents.ocr.tables'])throw Error('This server does not support OCR table analysis.');
 const result=await parseOcrTables(await api.request<unknown>(`/v1/episodes/${address.episodeId}/document/ocr-tables?page=${address.page.number}`,options),address);
 const source=record(await api.request<unknown>(`/v1/episodes/${address.episodeId}`,options));
 if(source.episode_id!==address.episodeId||source.kind!=='file'||source.content!==address.source.content||JSON.stringify(documentBinding(source))!==JSON.stringify(address.source.binding))throw Error('The retained source changed during table analysis.');
 if(signal.aborted)throw Error('Table analysis cancelled.');
 return result;
}
