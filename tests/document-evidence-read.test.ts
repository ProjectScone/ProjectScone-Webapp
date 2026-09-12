import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApiClient} from '../src/api.ts';
import {FEATURE_KEYS} from '../src/capabilities.ts';
import {documentBinding} from '../src/memory/document-evidence.ts';
import {readDocumentEvidence} from '../src/memory/document-evidence-read.ts';

for(const mode of ['valid','space','capability','forgotten','text','binding','id','kind','preabort','finalabort','bad-evidence'])test(`document evidence revalidation: ${mode}`,async()=>{
 const original={attachment_id:'a'.repeat(64),media_type:'text/plain',bytes:5};
 const manifest={attachment_id:'b'.repeat(64),media_type:'application/json',bytes:200};
 const episode={episode_id:7,kind:'file',content:'hello',metadata:{document_original:original.attachment_id,document_manifest:manifest.attachment_id,document_format:'text'},attachments:[original,manifest]};
 const binding=documentBinding(episode);assert.ok(binding);
 const source={content:episode.content,binding},calls:string[]=[],controller=new AbortController();
 const server=createServer((req,res)=>{
  calls.push(req.url!);assert.equal(req.method,'GET');assert.equal(req.headers.authorization,'Bearer fixture');
  assert.equal(req.headers.referer,undefined);assert.equal(req.headers.cookie,undefined);
  res.setHeader('content-type','application/json');const send=(value:unknown)=>res.end(JSON.stringify(value));
  if(req.url==='/v1/status')return send({space:mode==='space'?'beta':'alpha'});
  if(req.url==='/v1/capabilities')return send({schema_version:1,implementation:'fixture',features:{...Object.fromEntries(FEATURE_KEYS.map(key=>[key,true])),'documents.provenance':mode!=='capability'}});
  if(req.url==='/v1/episodes/7/document')return send({original,manifest,filename:'hello.txt',format:mode==='bad-evidence'?'pdf':'text',parser:'text',segments:[{locator:'text:1',text:'hello'}]});
  assert.equal(req.url,'/v1/episodes/7');
  if(mode==='forgotten'){res.statusCode=410;return send({error:'gone'});}
  if(mode==='finalabort')controller.abort();
  return send({...episode,episode_id:mode==='id'?8:7,kind:mode==='kind'?'note':'file',content:mode==='text'?'changed':'hello',...(mode==='binding'?{metadata:{...episode.metadata,document_manifest:'c'.repeat(64)}}:{})});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const api=createApiClient('fixture',()=>{},`http://127.0.0.1:${address.port}`);
  if(mode==='preabort')controller.abort();
  const result=readDocumentEvidence(api,source,7,'alpha',controller.signal);
  if(mode==='valid')assert.equal((await result).filename,'hello.txt');else await assert.rejects(result);
  const expected=['/v1/status','/v1/capabilities','/v1/episodes/7/document','/v1/episodes/7'];
  const length=mode==='preabort'?0:mode==='space'?1:mode==='capability'?2:mode==='bad-evidence'?3:4;
  assert.deepEqual(calls,expected.slice(0,length));
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
