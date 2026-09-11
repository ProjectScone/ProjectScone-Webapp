import {test} from 'node:test';
import assert from 'node:assert/strict';
import {neighborhoodRequest,parseNeighborhood} from '../src/memory/knowledge-neighborhood.ts';
import {parseKnowledge} from '../src/memory/knowledge.ts';
const entity=(id:string)=>({id:`ent:${id}`,key:id,label:id,kind:null,kind_status:'unknown',claims:1});
const fixture=()=>({schema_version:1,space:'alpha',projection:{version:'v',classifier:'c',kinds:'k',id_scheme:'i',digest:'d',revision:2},filters:{status:'current',as_of:'2026-09-11T12:00:00.000Z',seeds:['ent:alice'],hub_degree:64},entities:[entity('alice'),entity('bob')],relations:[{id:'rel:ab',subject_id:'ent:alice',object_id:'ent:bob',predicate:'knows',fact_ids:[1],support:{facts:1}}],attributes:[],coverage:{facts_read:1,facts_counted:1,facts_limit:50000,entities_total:3,entities_shown:2,relations_total:1,relations_shown:1,attributes_total:0,attributes_shown:0,truncated:true,reasons:['outside_walk']}});
const graph=()=>parseKnowledge(fixture(),'current','alpha');
test('neighborhood requests bind exact distinct seeds and bounded settings',()=>{
 const seeds=[{id:'ent:alice',key:'alice',label:'Alice'}];assert.deepEqual(neighborhoodRequest(seeds,150,64),{seeds,limit:150,hubDegree:64});
 for(const [limit,hub] of [[0,64],[1001,64],[1,0],[1,100001],[1.5,64],[1,NaN]])assert.throws(()=>neighborhoodRequest(seeds,limit,hub));
 assert.throws(()=>neighborhoodRequest([],150,64));assert.throws(()=>neighborhoodRequest([...seeds,...seeds],150,64));
 assert.throws(()=>neighborhoodRequest(Array.from({length:25},(_,i)=>({id:`ent:${i}`,key:String(i),label:String(i)})),150,64));
 assert.throws(()=>neighborhoodRequest([...seeds,{id:'ent:bob',key:'bob',label:'Bob'}],1,64));
});
test('neighborhood keeps support and reports omitted or hub-limited evidence',()=>{
 const request=neighborhoodRequest([{id:'ent:alice',key:'alice',label:'alice'}],150,64),value=fixture();value.coverage.reasons.push('hub_skipped');
 const parsed=parseNeighborhood(value,graph(),request);assert.equal(parsed.entities.length,2);assert.deepEqual(parsed.relations[0].factIds,[1]);assert(parsed.coverage.reasons.includes('hub_skipped'));
});
test('neighborhood rejects wrong snapshot, seed identity, hub policy and ignored limit',()=>{
 const request=neighborhoodRequest([{id:'ent:alice',key:'alice',label:'alice'}],150,64);
 for(const change of [(v:ReturnType<typeof fixture>)=>v.space='beta',(v:ReturnType<typeof fixture>)=>v.projection.revision++,(v:ReturnType<typeof fixture>)=>v.filters.hub_degree=1,(v:ReturnType<typeof fixture>)=>v.filters.seeds=['ent:bob'],(v:ReturnType<typeof fixture>)=>v.entities[0].key='eve']){
  const value=fixture();change(value);assert.throws(()=>parseNeighborhood(value,graph(),request));
 }
 assert.throws(()=>parseNeighborhood(fixture(),graph(),{...request,limit:1}));
});
test('neighborhood rejects missing seeds, unrelated islands and silent omissions',()=>{
 const request=neighborhoodRequest([{id:'ent:alice',key:'alice',label:'alice'}],150,64);
 const missing=fixture();missing.entities[0].id='ent:eve';missing.relations[0].subject_id='ent:eve';assert.throws(()=>parseNeighborhood(missing,graph(),request));
 const island=fixture();island.relations=[];island.coverage.relations_shown=0;assert.throws(()=>parseNeighborhood(island,graph(),request));
 const hidden=fixture();hidden.coverage.truncated=false;hidden.coverage.reasons=[];assert.throws(()=>parseNeighborhood(hidden,graph(),request));
});
test('starting entities cannot override the known map identity',()=>{
 const request=neighborhoodRequest([{id:'ent:alice',key:'mallory',label:'Mallory'}],150,64),value=fixture();value.entities[0].key='mallory';value.entities[0].label='Mallory';
 assert.throws(()=>parseNeighborhood(value,graph(),request));
});
test('neighborhood rejects demonstrated traversal beyond a nonseed hub cutoff',()=>{
 const value=fixture();value.entities.push(entity('carol'));value.coverage.entities_shown=3;
 value.relations.push({id:'rel:bc',subject_id:'ent:bob',object_id:'ent:carol',predicate:'knows',fact_ids:[2],support:{facts:1}});value.coverage.relations_total=2;value.coverage.relations_shown=2;value.filters.hub_degree=1;
 assert.throws(()=>parseNeighborhood(value,graph(),neighborhoodRequest([{id:'ent:alice',key:'alice',label:'alice'}],150,1)));
 value.filters.seeds.push('ent:bob');assert.equal(parseNeighborhood(value,graph(),neighborhoodRequest([{id:'ent:alice',key:'alice',label:'alice'},{id:'ent:bob',key:'bob',label:'bob'}],150,1)).entities.length,3);
});
test('neighborhood cannot change support for a relationship already on the map',()=>{
 const request=neighborhoodRequest([{id:'ent:alice',key:'alice',label:'alice'}],150,64);
 for(const change of [(v:ReturnType<typeof fixture>)=>v.relations[0].predicate='dislikes',(v:ReturnType<typeof fixture>)=>v.relations[0].fact_ids=[2]]){
  const value=fixture();change(value);assert.throws(()=>parseNeighborhood(value,graph(),request));
 }
});
