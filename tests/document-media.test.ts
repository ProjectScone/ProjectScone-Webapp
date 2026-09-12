import test from 'node:test';
import assert from 'node:assert/strict';
import {documentBinding,parseDocumentEvidence} from '../src/memory/document-evidence.ts';

function fixture(){
 const original={attachment_id:'a'.repeat(64),bytes:100,media_type:'application/octet-stream'},manifest={attachment_id:'b'.repeat(64),bytes:300,media_type:'application/json'};
 const episode={metadata:{document_original:original.attachment_id,document_manifest:manifest.attachment_id,document_format:'wav'},attachments:[original,manifest]};
 const binding=documentBinding(episode);assert.ok(binding);
 return {source:{content:'Café launch.\n\nFriday.',binding},value:{original,manifest,format:'wav',filename:'launch.wav',parser:'media-transcription',metadata:{extraction:'audio-only',sample_rate:'16000',duration_seconds:'2.0',transcriber_revision:'local-v1',audio_wav_sha256:'c'.repeat(64),audio_wav_bytes:'64044'},segments:[
  {locator:'audio:0/segment:1/seconds:0.0-1.5',text:'Café launch.',metadata:{extraction:'transcription',audio_stream:'0',start_seconds:'0.0',end_seconds:'1.5'}},
  {locator:'audio:0/segment:2/seconds:1.0-2.0',text:'Friday.',metadata:{extraction:'transcription',audio_stream:'0',start_seconds:'1.0',end_seconds:'2.0'}},
 ]}};
}
test('media evidence retains validated overlapping source times and normalized audio identity',()=>{
 const f=fixture(),media=parseDocumentEvidence(f.value,f.source).media;assert.ok(media);
 assert.equal(media.durationSeconds,2);assert.equal(media.revision,'local-v1');
 assert.deepEqual(media.segments.map(s=>[s.startSeconds,s.endSeconds]),[[0,1.5],[1,2]]);
 assert.equal(media.audio?.bytes,64044);assert.equal(media.audio?.attachment_id,'c'.repeat(64));
});
for(const [key,value] of [['start_seconds','NaN'],['start_seconds','-1'],['end_seconds','0'],['end_seconds','3'],['audio_stream','1'],['extraction','ocr'],['start_seconds',' 0 ']])test(`refuse inconsistent transcript ${key}=${value}`,()=>{
 const f=fixture();Object.assign(f.value.segments[0].metadata,{[key]:value});assert.throws(()=>parseDocumentEvidence(f.value,f.source),/media|transcript|audio/i);
});
for(const change of [{sample_rate:'48000'},{duration_seconds:'0'},{duration_seconds:'Infinity'},{audio_wav_bytes:'64045'},{audio_wav_sha256:'bad'},{transcriber_revision:'bad revision'}])test(`refuse inconsistent media metadata ${JSON.stringify(change)}`,()=>{
 const f=fixture();Object.assign(f.value.metadata,change);assert.throws(()=>parseDocumentEvidence(f.value,f.source));
});
test('incomplete or reordered transcript inventory is refused',()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.value.segments[1].locator=f.value.segments[0].locator;},(f:ReturnType<typeof fixture>)=>{f.value.segments[1].metadata.start_seconds='0';},(f:ReturnType<typeof fixture>)=>{f.value.segments[1].metadata.end_seconds='0.5';}]){
  const f=fixture();f.value.segments[0].metadata.start_seconds='0.5';f.value.segments[0].locator='audio:0/segment:1/seconds:0.5-1.5';mutate(f);assert.throws(()=>parseDocumentEvidence(f.value,f.source));
 }
});
test('older transcript evidence can be inspected without pretending normalized playback exists',()=>{
 const f=fixture();Reflect.deleteProperty(f.value.metadata,'audio_wav_sha256');Reflect.deleteProperty(f.value.metadata,'audio_wav_bytes');Reflect.deleteProperty(f.value.metadata,'transcriber_revision');
 assert.equal(parseDocumentEvidence(f.value,f.source).media?.audio,undefined);
});

test('native negative-zero timestamps retain their valid source locator',()=>{
 const f=fixture();f.value.segments[0].metadata.start_seconds='-0.0';f.value.segments[0].locator='audio:0/segment:1/seconds:-0.0-1.5';
 const media=parseDocumentEvidence(f.value,f.source).media;assert.ok(media);assert.equal(media.segments[0].startSeconds,-0);
});

test('window coverage retains counts and distinguishes older unknown coverage',()=>{
 const f=fixture();Object.assign(f.value.metadata,{transcription_windows:'quiet-audio-windows-v1',chunk_seconds:'1',transcription_window_count:'2',transcription_empty_windows:'1'});
 assert.deepEqual(parseDocumentEvidence(f.value,f.source).media?.windowing,{maxSeconds:1,coverage:{windows:2,emptyWindows:1}});
 Reflect.deleteProperty(f.value.metadata,'transcription_window_count');Reflect.deleteProperty(f.value.metadata,'transcription_empty_windows');
 assert.deepEqual(parseDocumentEvidence(f.value,f.source).media?.windowing,{maxSeconds:1,coverage:undefined});
 assert.equal(parseDocumentEvidence(fixture().value,fixture().source).media?.windowing,undefined);
});
for(const change of [{transcription_window_count:'0'},{transcription_empty_windows:'2'},{transcription_empty_windows:'-1'},{transcription_window_count:2},{transcription_empty_windows:undefined},{chunk_seconds:'0'},{transcription_windows:undefined}])test(`invalid window coverage is refused: ${JSON.stringify(change)}`,()=>{
 const f=fixture();Object.assign(f.value.metadata,{transcription_windows:'quiet-audio-windows-v1',chunk_seconds:'1',transcription_window_count:'2',transcription_empty_windows:'1'},change);
 assert.throws(()=>parseDocumentEvidence(f.value,f.source));
});
