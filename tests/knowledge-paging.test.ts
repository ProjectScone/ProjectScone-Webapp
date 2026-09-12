import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseKnowledgePage,moveKnowledgePage} from '../src/memory/knowledge-paging.ts';
const fixture=(offset=0,total=5)=>({schema_version:1,space:'alpha',projection:{version:'v',classifier:'c',kinds:'k',id_scheme:'i',digest:'d',revision:3},filters:{status:'current',as_of:'2026-09-11T12:00:00.000Z'},entities:Array.from({length:Math.min(2,total-offset)},(_,i)=>({id:`ent:${offset+i}`,key:`entity ${offset+i}`,label:`Entity ${offset+i}`,kind:null,kind_status:'unknown',claims:1})),relations:[],attributes:[],coverage:{facts_read:5,facts_counted:5,facts_limit:50000,entities_total:total,entities_shown:Math.min(2,total-offset),relations_total:0,relations_shown:0,attributes_total:0,attributes_shown:0,truncated:total>2,reasons:total>2?['entity_limit']:[],...(offset+2<total?{next_cursor:`cursor${offset+2}`}:{})}});
test('knowledge pages traverse all entities and back under one snapshot',()=>{
 const first=parseKnowledgePage(fixture(),'current','alpha',null,true,2);
 const secondTrail=moveKnowledgePage(null,first,1),second=parseKnowledgePage(fixture(2),'current','alpha',secondTrail,true,2);
 const thirdTrail=moveKnowledgePage(secondTrail,second,1),third=parseKnowledgePage(fixture(4),'current','alpha',thirdTrail,true,2);
 assert.equal(third.nextCursor,null);assert.throws(()=>moveKnowledgePage(thirdTrail,third,1));
 const back=moveKnowledgePage(thirdTrail,third,-1);
 assert.equal(back.index,1);assert.equal(parseKnowledgePage(fixture(2),'current','alpha',back,true,2).graph.entities[0].id,'ent:2');
 assert.throws(()=>moveKnowledgePage(null,first,-1));
});
test('page reads reject changed snapshot, instant, totals and repeated entities',()=>{
 const first=parseKnowledgePage(fixture(),'current','alpha',null,true,2),trail=moveKnowledgePage(null,first,1);
 for(const change of [(v:ReturnType<typeof fixture>)=>v.projection.revision++,(v:ReturnType<typeof fixture>)=>v.projection.digest='different',(v:ReturnType<typeof fixture>)=>v.filters.as_of='2026-09-12T12:00:00.000Z',(v:ReturnType<typeof fixture>)=>v.coverage.entities_total++,(v:ReturnType<typeof fixture>)=>v.entities[0].id='ent:0']){
  const value=fixture(2);change(value);assert.throws(()=>parseKnowledgePage(value,'current','alpha',trail,true,2));
 }
});
test('paging rejects ignored cursors, missing continuation, cycles and excess records',()=>{
 const first=parseKnowledgePage(fixture(),'current','alpha',null,true,2),trail=moveKnowledgePage(null,first,1);
 assert.throws(()=>parseKnowledgePage(fixture(),'current','alpha',trail,true,2));
 const missing=fixture();delete missing.coverage.next_cursor;assert.throws(()=>parseKnowledgePage(missing,'current','alpha',null,true,2));
 const cycle=fixture(2);cycle.coverage.next_cursor='cursor2';assert.throws(()=>parseKnowledgePage(cycle,'current','alpha',trail,true,2));
 assert.throws(()=>parseKnowledgePage(fixture(),'current','alpha',null,true,1));
});
test('legacy views remain readable and cannot authorize cursor navigation',()=>{
 const value=fixture();delete value.coverage.next_cursor;
 const page=parseKnowledgePage(value,'current','alpha',null,false,2);assert.equal(page.nextCursor,null);
 assert.throws(()=>moveKnowledgePage(null,page,1));
 assert.equal(parseKnowledgePage(fixture(),'current','alpha',null,false,2).nextCursor,null);
});
test('opaque cursors are bounded and never accepted as arbitrary URLs',()=>{
 for(const cursor of ['',42,'https://other.test/page','x'.repeat(513)]){
  const value=fixture();Object.assign(value.coverage,{next_cursor:cursor});
  assert.throws(()=>parseKnowledgePage(value,'current','alpha',null,true,2));
 }
});
test('returning to a visited page verifies the same ordered entity membership',()=>{
 const first=parseKnowledgePage(fixture(),'current','alpha',null,true,2),trail=moveKnowledgePage(null,first,1);
 const second=parseKnowledgePage(fixture(2),'current','alpha',trail,true,2),back=moveKnowledgePage(trail,second,-1);
 const changed=fixture();changed.entities.reverse();assert.throws(()=>parseKnowledgePage(changed,'current','alpha',back,true,2));
});
