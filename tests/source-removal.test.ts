import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseForgetReceipt,parseForgetStatus,readRemoval,removeSource} from '../src/memory/source-removal.ts';
const receipt={episode_id:7,chunks:2,attachments_released:['a'.repeat(64)],attachments_kept:['b'.repeat(64)],facts_citing:[1,2],links_citing:[3],forgotten_at:null};
test('impact and completion bind exact source, counts, identities and time',()=>{
 assert.equal(parseForgetReceipt(receipt,7,false).chunks,2);
 assert.equal(parseForgetReceipt({...receipt,forgotten:7,forgotten_at:'2026-09-11T21:00:00Z'},7,true).episode_id,7);
 for(const bad of [{episode_id:8},{chunks:-1},{chunks:true},{facts_citing:[1,1]},{links_citing:[0]},{attachments_kept:receipt.attachments_released},{forgotten_at:'garbage'}])assert.throws(()=>parseForgetReceipt({...receipt,...bad},7,false));
 assert.throws(()=>parseForgetReceipt(receipt,7,true));
 assert.throws(()=>parseForgetReceipt({...receipt,forgotten:8,forgotten_at:'2026-09-11T21:00:00Z'},7,true));
});
test('status never invents a completed receipt and rejects contradictory fields',()=>{
 assert.equal(parseForgetStatus({episode_id:7,state:'forgotten',forgotten_at:'2026-09-11T21:00:00Z'},7).state,'forgotten');
 assert.equal(parseForgetStatus({episode_id:7,state:'pending',requested_at:'2026-09-11T21:00:00Z',impact:receipt},7).state,'pending');
 for(const bad of [{state:'pending'},{state:'forgotten'},{state:'present',impact:receipt},{state:'present',forgotten_at:'2026-09-11T21:00:00Z'},{state:'present',episode_id:8}])assert.throws(()=>parseForgetStatus({episode_id:7,...bad},7));
});
test('read checks space and capability before source endpoints; every request is read only',async()=>{
 const paths:string[]=[];
 const api={async request<T>(path:string,options?:RequestInit):Promise<T>{paths.push(path);assert.notEqual(options?.method,'DELETE');return {space:'other'} as T;}};
 await assert.rejects(readRemoval(api,{episodeId:7,space:'alpha'},new AbortController().signal),/different space/);
 assert.deepEqual(paths,['/v1/status']);
});
test('a lost removal response is never retried and cannot become a receipt',async()=>{
 let calls=0;
 const api={async request<T>(path:string,options?:RequestInit):Promise<T>{calls++;assert.equal(path,'/v1/episodes/7');assert.equal(options?.method,'DELETE');assert.equal(options?.redirect,'error');throw Error('lost response');}};
 await assert.rejects(removeSource(api,7,new AbortController().signal),/lost response/);assert.equal(calls,1);
});


test('removal evidence rejects impossible dates and clock values',()=>{
 for(const time of ['2026-02-30T00:00:00Z','2026-09-11T24:00:00Z','0000-01-01T00:00:00Z']){
  assert.throws(()=>parseForgetStatus({episode_id:7,state:'forgotten',forgotten_at:time},7));
  assert.throws(()=>parseForgetReceipt({...receipt,forgotten:7,forgotten_at:time},7,true));
 }
 assert.equal(parseForgetStatus({episode_id:7,state:'forgotten',forgotten_at:'2024-02-29T23:59:59.125-05:00'},7).state,'forgotten');
});
