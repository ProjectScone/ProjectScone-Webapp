import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createApiClient} from '../src/api.ts';
import {FEATURE_KEYS} from '../src/capabilities.ts';
import {documentBinding,parseDocumentEvidence} from '../src/memory/document-evidence.ts';
import {prepareMediaPlayback} from '../src/memory/document-media-playback.ts';

for(const mode of ['valid','corrupt','samples','header','forgotten','space','cancel'])test(`normalized playback rejects stale or changed evidence: ${mode}`,async()=>{
 const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
 if(mode==='header')wav.writeUInt32LE(48000,24);
 const original={attachment_id:'a'.repeat(64),bytes:100,media_type:'application/octet-stream'},manifest={attachment_id:'b'.repeat(64),bytes:200,media_type:'application/json'};
 const episode={episode_id:7,kind:'file',content:'Hello',metadata:{document_original:original.attachment_id,document_manifest:manifest.attachment_id,document_format:'wav'},attachments:[original,manifest]};
 const binding=documentBinding(episode);assert.ok(binding);const source={content:'Hello',binding};
 const evidence={original,manifest,filename:'hello.wav',format:'wav',parser:'media-transcription',metadata:{extraction:'audio-only',duration_seconds:'1.0',sample_rate:'16000',transcriber_revision:'v1',audio_wav_sha256:createHash('sha256').update(wav).digest('hex'),audio_wav_bytes:String(wav.length)},segments:[{text:'Hello',locator:'audio:0/segment:1/seconds:0.0-1.0',metadata:{extraction:'transcription',audio_stream:'0',start_seconds:'0.0',end_seconds:'1.0'}}]};
 const media=parseDocumentEvidence(evidence,source).media;assert.ok(media);
 let served=false;const calls:string[]=[],controller=new AbortController();
 const server=createServer((req,res)=>{
  calls.push(req.url!);assert.equal(req.method,'GET');assert.equal(req.headers.authorization,'Bearer fixture');assert.equal(req.headers.referer,undefined);
  res.setHeader('content-type','application/json');const send=(v:unknown)=>res.end(JSON.stringify(v));
  if(req.url==='/v1/status')return send({space:served&&mode==='space'?'beta':'alpha'});
  if(req.url==='/v1/capabilities')return send({schema_version:1,implementation:'fixture',features:{...Object.fromEntries(FEATURE_KEYS.map(key=>[key,true])),'documents.provenance':true}});
  if(req.url==='/v1/episodes/7/document')return send(evidence);
  if(req.url==='/v1/episodes/7/document/audio'){
   served=true;res.setHeader('content-type','audio/wav');
   if(mode==='cancel')controller.abort();
   if(mode==='samples'){const altered=Buffer.from(wav);altered[44]=1;return res.end(altered);}
   return res.end(mode==='corrupt'?Buffer.alloc(wav.length):wav);
  }
  assert.equal(req.url,'/v1/episodes/7');if(served&&mode==='forgotten'){res.statusCode=410;return send({error:'forgotten'});}return send(episode);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const api=createApiClient('fixture',()=>{},`http://127.0.0.1:${address.port}`);
  const result=prepareMediaPlayback(api,source,7,'alpha',media,controller.signal);
  if(mode==='valid'){const blob=await result;assert.equal(blob.type,'audio/wav');assert.deepEqual(Buffer.from(await blob.arrayBuffer()),wav);assert.equal(calls.at(-1),'/v1/episodes/7');}
  else if(mode==='samples')await assert.rejects(result,/digest/i);
  else await assert.rejects(result);
  assert.equal(calls.filter(path=>path.endsWith('/audio')).length,1);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
