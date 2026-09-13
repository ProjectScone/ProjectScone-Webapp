import test from 'node:test';
import assert from 'node:assert/strict';
import {videoFixture} from './document-video.test.ts';
import {parseVideoCatalogue} from '../src/memory/document-video.ts';
import {parseVideoUnderstanding,interpretVideoFrame} from '../src/memory/video-understanding.ts';
import type {ApiClient} from '../src/api.ts';

function fixture(){
 const f=videoFixture(),video=parseVideoCatalogue(f.catalogue,f.source,7,'alpha'),frame=video.frames[0];
 const response={schema_version:1,space:'alpha',episode_id:'7',original_sha256:f.source.binding.original.attachment_id,
  manifest_sha256:f.source.binding.manifest.attachment_id,persisted:false,
  frame:{ordinal:frame.ordinal,presentation_timestamp:frame.presentationTimestamp,time_base:video.timeBase,png_sha256:frame.sha256,width:frame.width,height:frame.height},
  understanding:{text:'Generated scene description.',model:'local-choice',origin:'model_generated',source:'video:episode:7/stream:0/frame:0',attachment_id:frame.sha256,media_type:'image/png',width:frame.width,height:frame.height}};
 return {...f,video,frame,response};
}
test('interpretation is bound to exact retained source, frame and original int64 clock',()=>{
 const f=fixture(),result=parseVideoUnderstanding(f.response,f.source,f.video,f.frame,7,'alpha');
 assert.equal(result.text,'Generated scene description.');assert.equal(result.model,'local-choice');
 for(const patch of [{space:'beta'},{episode_id:7},{persisted:true},{original_sha256:'e'.repeat(64)},{manifest_sha256:'e'.repeat(64)}]){
  assert.throws(()=>parseVideoUnderstanding({...f.response,...patch},f.source,f.video,f.frame,7,'alpha'));
 }
 for(const patch of [{presentation_timestamp:Number(f.frame.presentationTimestamp)},{ordinal:1},{time_base:'1/3'},{png_sha256:'e'.repeat(64)},{width:1}]){
  assert.throws(()=>parseVideoUnderstanding({...f.response,frame:{...f.response.frame,...patch}},f.source,f.video,f.frame,7,'alpha'));
 }
 for(const patch of [{origin:'approved'},{source:'other'},{attachment_id:'e'.repeat(64)},{text:'\ud800'},{text:' '},{text:'x'.repeat(64001)},{height:true},{media_type:'image/jpeg'}]){
  assert.throws(()=>parseVideoUnderstanding({...f.response,understanding:{...f.response.understanding,...patch}},f.source,f.video,f.frame,7,'alpha'));
 }
});
test('explicit interpretation performs one POST and finishes on a bound catalogue read',async()=>{
 const f=fixture(),calls:string[]=[];
 const api={request:async<T>(path:string,options:RequestInit):Promise<T>=>{
  calls.push(`${options.method??'GET'} ${path}`);
  return (path==='/v1/status'?{space:'alpha'}:path.endsWith('/understand')?f.response:f.catalogue) as T;
 }} as Pick<ApiClient,'request'>;
 await interpretVideoFrame(api,f.source,f.video,f.frame,7,'alpha','Describe',new AbortController().signal);
 assert.equal(calls.filter(c=>c.startsWith('POST')).length,1);
 assert.equal(calls.at(-1),'GET /v1/episodes/7/document/video/catalogue');
});
test('invalid prompt and changed evidence refuse without inference',async()=>{
 const f=fixture(),calls:string[]=[];
 const api={request:async<T>(path:string,options:RequestInit):Promise<T>=>{calls.push(options.method??'GET');return (path==='/v1/status'?{space:'alpha'}:{...f.catalogue,space:'beta'}) as T;}} as Pick<ApiClient,'request'>;
 for(const prompt of ['',' ','x'.repeat(16001),'😀'.repeat(16001),'\ud800'])await assert.rejects(interpretVideoFrame(api,f.source,f.video,f.frame,7,'alpha',prompt,new AbortController().signal));
 assert.deepEqual(calls,[]);
 await assert.rejects(interpretVideoFrame(api,f.source,f.video,f.frame,7,'alpha','Describe',new AbortController().signal));
 assert.ok(!calls.includes('POST'));
});


test('native Unicode codepoint limits admit emoji without counting surrogate halves',()=>{
 const f=fixture();f.response.understanding.text='😀'.repeat(32001);f.response.understanding.model='😀'.repeat(160);
 assert.equal(parseVideoUnderstanding(f.response,f.source,f.video,f.frame,7,'alpha').text,f.response.understanding.text);
});


test('Unicode results still enforce codepoint bounds and valid scalar values',()=>{
 const f=fixture();
 for(const patch of [{text:'😀'.repeat(64001)},{model:'😀'.repeat(257)},{model:'\ud800'}]){
  assert.throws(()=>parseVideoUnderstanding({...f.response,understanding:{...f.response.understanding,...patch}},f.source,f.video,f.frame,7,'alpha'));
 }
});
