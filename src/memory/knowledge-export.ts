import {KNOWLEDGE_MODES,type Knowledge,type KnowledgeMode} from './knowledge.ts';

export const EXPORT_FORMATS={
 json:{label:'JSON',mediaType:'application/json',filename:'graph.json',description:'Nodes, relationships, values and metadata for graph libraries.'},
 graphml:{label:'GraphML',mediaType:'application/graphml+xml',filename:'graph.graphml',description:'XML graph data for Gephi, yEd and NetworkX.'},
 cypher:{label:'Cypher',mediaType:'text/plain',filename:'graph.cypher',description:'Statements to import entities and relationships into a compatible graph database.'},
 csv:{label:'CSV archive',mediaType:'application/zip',filename:'graph-csv.zip',description:'Separate entity, relationship and value tables in a ZIP archive.'},
 jsonld:{label:'JSON-LD',mediaType:'application/ld+json',filename:'graph.jsonld',description:'Linked data with supporting claim identities.'},
 obsidian:{label:'Obsidian archive',mediaType:'application/zip',filename:'graph-obsidian.zip',description:'Linked Markdown entity notes and an index in a ZIP archive.'},
} as const;
export type GraphExportFormat=keyof typeof EXPORT_FORMATS;
export interface GraphExportRequest {format:GraphExportFormat;space:string;status:KnowledgeMode;asOf:string;digest:string;revision:number}
export interface GraphExportFile {blob:Blob;filename:string;truncated:boolean}
export const MAX_GRAPH_EXPORT_BYTES=100*1024*1024;

export function exportRequest(graph:Knowledge,format:GraphExportFormat):GraphExportRequest {
 const identity:unknown=JSON.parse(graph.identity);
 if(!Array.isArray(identity)||typeof identity[4]!=='string')throw Error('Invalid displayed projection identity');
 return {format,space:graph.space,status:graph.mode,asOf:graph.asOf,digest:identity[4],revision:graph.revision};
}
export function exportAddress(request:GraphExportRequest):string {
 if(!Object.hasOwn(EXPORT_FORMATS,request.format)||!KNOWLEDGE_MODES.includes(request.status)
  ||!/^[A-Za-z0-9_.:-]{1,128}$/.test(request.space)||!/^[a-f0-9]{64}$/.test(request.digest)
  ||!Number.isSafeInteger(request.revision)||request.revision<0||!Number.isFinite(Date.parse(request.asOf)))throw Error('Invalid graph export request');
 return '/v1/graph/export?'+new URLSearchParams({format:request.format,status:request.status,as_of:request.asOf});
}
function metadata(response:Response,request:GraphExportRequest):boolean {
 const h=response.headers;
 if(!response.ok||response.redirected)throw Error('Invalid graph export response');
 const expected={'x-scone-space':request.space,'x-scone-status':request.status,'x-scone-as-of':request.asOf,'x-scone-projection-digest':request.digest,'x-scone-projection-revision':String(request.revision)};
 if(Object.entries(expected).some(([name,value])=>h.get(name)!==value))throw Error('The export does not match this graph. Refresh the graph and prepare it again.');
 if(h.get('content-type')?.split(';')[0].trim().toLowerCase()!==EXPORT_FORMATS[request.format].mediaType)throw Error('The export has an unexpected file type.');
 const truncated=h.get('x-scone-truncated');if(truncated!=='true'&&truncated!=='false')throw Error('The export did not disclose its coverage.');
 return truncated==='true';
}
async function boundedBytes(response:Response,signal?:AbortSignal):Promise<Uint8Array<ArrayBuffer>[]> {
 const length=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');
 const declared=length!==null&&(!encoding||encoding==='identity')?Number(length):null;
 if(declared!==null&&(!/^\d+$/.test(length!)||!Number.isSafeInteger(declared)||declared<0))throw Error('Invalid export size.');
 if(declared!==null&&declared>MAX_GRAPH_EXPORT_BYTES)throw Error('This export is too large for the browser’s 100 MiB download limit.');
 const reader=response.body?.getReader();if(!reader)throw Error('The export is empty.');
 const abort=()=>{void reader.cancel(signal?.reason).catch(()=>{});};
 signal?.addEventListener('abort',abort,{once:true});
 const chunks:Uint8Array<ArrayBuffer>[]=[];let bytes=0;
 try{
  signal?.throwIfAborted();
  while(true){const {done,value}=await reader.read();signal?.throwIfAborted();if(done)break;bytes+=value.byteLength;
   if(bytes>MAX_GRAPH_EXPORT_BYTES)throw Error('This export is too large for the browser’s 100 MiB download limit.');
   chunks.push(new Uint8Array(value));
  }
  if(!bytes)throw Error('The export is empty.');
  if(declared!==null&&bytes!==declared)throw Error('The export size does not match the received file.');
  return chunks;
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
}
export async function readGraphExport(response:Response,request:GraphExportRequest,signal?:AbortSignal):Promise<GraphExportFile> {
 try{
  exportAddress(request);
  const truncated=metadata(response,request),chunks=await boundedBytes(response,signal);
  return {blob:new Blob(chunks,{type:EXPORT_FORMATS[request.format].mediaType}),filename:EXPORT_FORMATS[request.format].filename,truncated};
 }catch(error){if(!response.body?.locked)await response.body?.cancel().catch(()=>{});throw error;}
}
