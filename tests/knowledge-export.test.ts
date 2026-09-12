import {test} from 'node:test';import assert from 'node:assert/strict';
import {EXPORT_FORMATS,MAX_GRAPH_EXPORT_BYTES,readGraphExport,exportAddress,type GraphExportRequest} from '../src/memory/knowledge-export.ts';
const request:GraphExportRequest={format:'json',space:'alpha',status:'current',asOf:'2026-09-11T12:00:00Z',digest:'a'.repeat(64),revision:3};
const headers=()=>({'content-type':'application/json','x-scone-space':'alpha','x-scone-status':'current','x-scone-as-of':request.asOf,'x-scone-projection-digest':request.digest,'x-scone-projection-revision':'3','x-scone-truncated':'false'});
test('all six formats preserve received bytes and disclosed partial status',async()=>{
 for(const [format,spec] of Object.entries(EXPORT_FORMATS)){
  const bytes=new Uint8Array([0,1,13,10,255]),result=await readGraphExport(new Response(bytes,{headers:{...headers(),'content-type':spec.mediaType,'x-scone-truncated':'true'}}),{...request,format:format as GraphExportRequest['format']});
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),bytes);assert.equal(result.truncated,true);assert.equal(result.filename,spec.filename);
 }
});
test('exports reject changed graph metadata, wrong content type and missing disclosures',async()=>{
 for(const [key,value] of [['x-scone-space','beta'],['x-scone-status','history'],['x-scone-as-of','yesterday'],['x-scone-projection-digest','b'.repeat(64)],['x-scone-projection-revision','4'],['x-scone-truncated','unknown'],['content-type','text/html']]){
  await assert.rejects(readGraphExport(new Response('{}',{headers:{...headers(),[key]:value}}),request));
 }
 const missing=new Headers(headers());missing.delete('x-scone-space');await assert.rejects(readGraphExport(new Response('{}',{headers:missing}),request));
});
test('bounded export reads reject oversized, empty and length-mismatched bodies',async()=>{
 await assert.rejects(readGraphExport(new Response('x',{headers:{...headers(),'content-length':String(MAX_GRAPH_EXPORT_BYTES+1)}}),request),/large/i);
 await assert.rejects(readGraphExport(new Response('x',{headers:{...headers(),'content-length':'2'}}),request),/size/i);
 await assert.rejects(readGraphExport(new Response('',{headers:headers()}),request),/empty/i);
 let cancelled=false;const body=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
 await assert.rejects(readGraphExport(new Response(body,{headers:headers()}),request),/large/i);assert.equal(cancelled,true);
});
test('abort cancels a pending body read and never returns a file',async()=>{
 let cancelled=false;const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}}),controller=new AbortController();
 const promise=readGraphExport(new Response(body,{headers:headers()}),request,controller.signal);controller.abort();await assert.rejects(promise);assert.equal(cancelled,true);
});
test('export addresses restrict native formats, space, revision and view inputs',()=>{
 assert.match(exportAddress(request),/^\/v1\/graph\/export\?/);assert.equal(new URL('http://local'+exportAddress(request)).searchParams.get('as_of'),request.asOf);
 for(const bad of [{format:'../../secrets'},{space:'other/path'},{status:'wrong'},{revision:-1},{digest:'not-a-digest'},{asOf:'not-a-time'}])assert.throws(()=>exportAddress({...request,...bad} as GraphExportRequest));
});
test('decoded transfer bytes are bounded independently from compressed content length',async()=>{
 const result=await readGraphExport(new Response('decoded data',{headers:{...headers(),'content-encoding':'gzip','content-length':'5'}}),request);
 assert.equal(await result.blob.text(),'decoded data');
});
