import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVideoCatalogue,frameTimeLabel} from '../src/memory/document-video.ts';
import {prepareVideoFrame,readVideoCatalogue} from '../src/memory/document-video-read.ts';

export function videoFixture(){
 const original={attachment_id:'a'.repeat(64),media_type:'video/mp4',bytes:1000};
 const manifest={attachment_id:'b'.repeat(64),media_type:'application/json',bytes:3000};
 const frame=(ordinal:number,pts:string,empty:boolean)=>({ordinal,presentation_timestamp:pts,requested_seconds:[ordinal],width:64,height:32,png_sha256:'c'.repeat(64),png_bytes:100,ocr_engine:'fixture',empty});
 const region={text:'Café',box:[0.1,0.2,0.8,0.9],score:0.8,start:0,end:5,coordinate_space:'normalized_displayed_frame_top_left'};
 const evidence={original,manifest,filename:'slides.mp4',format:'mp4',parser:'video-frame-ocr',metadata:{},segments:[{locator:'video:stream:0/frame:0',text:'Café',metadata:{extraction:'ocr',engine:'fixture',video_frame_ordinal:'0'},regions:[region]}],
  video:{source_sha256:original.attachment_id,decoder_revision:'d'.repeat(64),policy_revision:'frames-v1',model_revision:'ocr-v1',
   policy:{interval_seconds:1,max_frames:64,max_duration_seconds:600,max_pixels:20000000,max_frame_bytes:10000000,max_total_bytes:32000000},
   stream_index:0,time_base:'1/2',start_timestamp:'9007199254740993',duration_ticks:'4',decoded_frames:2,unavailable_requests:0,
   frames:[frame(0,'9007199254740993',false),frame(1,'9007199254740995',true)]}};
 return {source:{content:'Café',binding:{original,manifest,format:'mp4'}},catalogue:{schema_version:1,timestamp_encoding:'decimal-string',space:'alpha',episode_id:'7',evidence}};
}
test('retain exact clocks, empty sampled frames, and UTF-8 OCR geometry',()=>{
 const f=videoFixture(),video=parseVideoCatalogue(f.catalogue,f.source,7,'alpha');
 assert.equal(video.startTimestamp,'9007199254740993');
 assert.equal(video.frames[1].presentationTimestamp,'9007199254740995');
 assert.equal(frameTimeLabel(video,video.frames[1]),'1 s');
 assert.equal(video.frames[0].regions[0].text,'Café');
 assert.equal(video.frames[0].regions[0].end,5);
 assert.equal(video.frames[1].empty,true);assert.deepEqual(video.frames[1].regions,[]);
});
test('refuse numeric or noncanonical int64 clocks before rendering',()=>{
 for(const timestamp of [9007199254740992,'01','-0','+1','1e2','9223372036854775808','-9223372036854775809','1'.repeat(1000)]){
  const f=videoFixture();Object.assign(f.catalogue.evidence.video,{start_timestamp:timestamp});
  assert.throws(()=>parseVideoCatalogue(f.catalogue,f.source,7,'alpha'));
 }
});
test('refuse catalogue versions, space or source substitutions',()=>{
 const mutations=[(f:ReturnType<typeof videoFixture>)=>{f.catalogue.schema_version=2;},
  (f:ReturnType<typeof videoFixture>)=>{f.catalogue.episode_id='8';},
  (f:ReturnType<typeof videoFixture>)=>{f.catalogue.space='beta';},
  (f:ReturnType<typeof videoFixture>)=>{f.catalogue.evidence.video.source_sha256='f'.repeat(64);},
  (f:ReturnType<typeof videoFixture>)=>{f.source.content='Elsewhere';}];
 for(const mutate of mutations){const f=videoFixture();mutate(f);assert.throws(()=>parseVideoCatalogue(f.catalogue,f.source,7,'alpha'));}
});
test('refuse inconsistent sampling and dishonest empty-frame claims',()=>{
 const mutations=[(v:ReturnType<typeof videoFixture>['catalogue']['evidence']['video'])=>{v.frames[1].empty=false;},
  (v:ReturnType<typeof videoFixture>['catalogue']['evidence']['video'])=>{v.frames[0].empty=true;},
  (v:ReturnType<typeof videoFixture>['catalogue']['evidence']['video'])=>{v.frames[1].ordinal=0;},
  (v:ReturnType<typeof videoFixture>['catalogue']['evidence']['video'])=>{v.frames[1].presentation_timestamp=v.start_timestamp;},
  (v:ReturnType<typeof videoFixture>['catalogue']['evidence']['video'])=>{v.frames[1].requested_seconds=[2];},
  (v:ReturnType<typeof videoFixture>['catalogue']['evidence']['video'])=>{v.unavailable_requests=1;},
  (v:ReturnType<typeof videoFixture>['catalogue']['evidence']['video'])=>{v.policy.max_total_bytes=199;}];
 for(const mutate of mutations){const f=videoFixture();mutate(f.catalogue.evidence.video);assert.throws(()=>parseVideoCatalogue(f.catalogue,f.source,7,'alpha'));}
});
test('refuse UTF-8 splits, substituted text, incorrect coordinate space and invalid boxes',()=>{
 for(const change of [{end:4},{start:4},{text:'Fake'},{coordinate_space:'normalized_displayed_page_top_left'},{box:[0.8,0.2,0.1,0.9]},{score:NaN}]){
  const f=videoFixture();Object.assign(f.catalogue.evidence.segments[0].regions[0],change);
  assert.throws(()=>parseVideoCatalogue(f.catalogue,f.source,7,'alpha'));
 }
});
test('time labels preserve fractional ticks and negative stream offsets',()=>{
 const f=videoFixture(),v=f.catalogue.evidence.video;
 v.start_timestamp='-9007199254740993';v.time_base='1/3';v.duration_ticks='6';
 v.frames[0].presentation_timestamp=v.start_timestamp;v.frames[1].presentation_timestamp='-9007199254740989';
 const result=parseVideoCatalogue(f.catalogue,f.source,7,'alpha');
 assert.equal(frameTimeLabel(result,result.frames[1]),'1 + 1/3 s');
});

test('frame preparation rechecks source and space after downloading pixels',async()=>{
 const f=videoFixture(),expected=parseVideoCatalogue(f.catalogue,f.source,7,'alpha');let changed=false;
 const api={request:async<T>(path:string):Promise<T>=>{
  const original=f.source.binding.original,manifest=f.source.binding.manifest;
  const source={episode_id:7,space:'alpha',kind:'file',content:changed?'Changed':f.source.content,
   metadata:{document_original:original.attachment_id,document_manifest:manifest.attachment_id,document_format:'mp4'},attachments:[original,manifest]};
  if(path.endsWith('/catalogue')&&changed)throw Error('Source changed');
  return (path==='/v1/status'?{space:'alpha'}:path.endsWith('/catalogue')?f.catalogue:source) as T;
 },documentVideoFrame:async()=>{changed=true;return new Blob(['pixels']);}};
 await assert.rejects(prepareVideoFrame(api,f.source,7,'alpha',expected,0,new AbortController().signal),/changed/);
});
test('a substituted catalogue refuses before any frame download',async()=>{
 const f=videoFixture(),expected=parseVideoCatalogue(f.catalogue,f.source,7,'alpha');let downloaded=false;
 f.catalogue.evidence.video.model_revision='changed';
 const {original,manifest}=f.source.binding;
 const api={request:async<T>(path:string):Promise<T>=>(path==='/v1/status'?{space:'alpha'}:path.endsWith('/catalogue')?f.catalogue:
  {episode_id:7,space:'alpha',kind:'file',content:f.source.content,metadata:{document_original:original.attachment_id,document_manifest:manifest.attachment_id,document_format:'mp4'},attachments:[original,manifest]}) as T,
  documentVideoFrame:async()=>{downloaded=true;return new Blob();}};
 await assert.rejects(prepareVideoFrame(api,f.source,7,'alpha',expected,0,new AbortController().signal));assert.equal(downloaded,false);
});
test('catalogue reader refuses changed connection space',async()=>{
 const f=videoFixture();let reads=0;
 const api={request:async<T>():Promise<T>=>{reads++;return {space:'beta'} as T;}};
 await assert.rejects(readVideoCatalogue(api,f.source,7,'alpha',new AbortController().signal));assert.equal(reads,1);
});

for(const operation of ['catalogue','frame'] as const)test(`${operation} refuses forgetting during the last connection check`,async()=>{
 const f=videoFixture(),expected=parseVideoCatalogue(f.catalogue,f.source,7,'alpha'),{original,manifest}=f.source.binding;
 let statuses=0,gone=false;
 const api={request:async<T>(path:string):Promise<T>=>{
  if(path==='/v1/status'){statuses++;if(statuses===(operation==='catalogue'?1:2))gone=true;return {space:'alpha'} as T;}
  if(gone)throw Error('Source forgotten');
  if(path.endsWith('/catalogue'))return f.catalogue as T;
  return {episode_id:7,space:'alpha',kind:'file',content:f.source.content,metadata:{document_original:original.attachment_id,document_manifest:manifest.attachment_id,document_format:'mp4'},attachments:[original,manifest]} as T;
 },documentVideoFrame:async()=>new Blob(['pixels'])};
 const signal=new AbortController().signal;
 await assert.rejects(operation==='catalogue'?readVideoCatalogue(api,f.source,7,'alpha',signal):prepareVideoFrame(api,f.source,7,'alpha',expected,0,signal),/forgotten/);
 assert.equal(gone,true);
});

test('final catalogue binds space without requiring a space field on legacy episode replies',async()=>{
 const f=videoFixture(),expected=parseVideoCatalogue(f.catalogue,f.source,7,'alpha');let downloaded=false;
 const api={request:async<T>(path:string):Promise<T>=>{
  if(path==='/v1/status')return {space:'alpha'} as T;
  assert.ok(path.endsWith('/catalogue'),'the final source check must use the space-bound catalogue');
  return {...f.catalogue,space:downloaded?'beta':'alpha'} as T;
 },documentVideoFrame:async()=>{downloaded=true;return new Blob(['pixels']);}};
 await assert.rejects(prepareVideoFrame(api,f.source,7,'alpha',expected,0,new AbortController().signal),/space/);
});


test('all-empty sampled frames retain a catalogue with no fabricated source text',()=>{
 const f=videoFixture();f.source.content='';f.catalogue.evidence.segments=[];
 for(const frame of f.catalogue.evidence.video.frames)frame.empty=true;
 const parsed=parseVideoCatalogue(f.catalogue,f.source,7,'alpha');
 assert.equal(parsed.frames.length,2);assert.deepEqual(parsed.document.segments,[]);
 assert.ok(parsed.frames.every(frame=>frame.text===''&&frame.regions.length===0));
 f.catalogue.evidence.video.frames[0].empty=false;
 assert.throws(()=>parseVideoCatalogue(f.catalogue,f.source,7,'alpha'));
});
