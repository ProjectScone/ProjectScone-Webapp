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

const walkFixture=()=>({
 ...fixture(),filters:{...fixture().filters,direction:'out',hops:2},
 entities:[{...entity('alice'),hop:0},{...entity('bob'),hop:1},{...entity('carol'),hop:2}],
 relations:[...fixture().relations,{id:'rel:bc',subject_id:'ent:bob',object_id:'ent:carol',predicate:'knows',fact_ids:[2],support:{facts:1}}],
 coverage:{...fixture().coverage,entities_total:3,entities_shown:3,relations_total:2,relations_shown:2,truncated:false,reasons:[] as string[]},
});
const walkRequest=()=>neighborhoodRequest([{id:'ent:alice',key:'alice',label:'alice'}],150,64,{direction:'out',hops:2});
test('directional walks retain recorded arrows and per-entity distances',()=>{
 const value=walkFixture(),result=parseNeighborhood(value,graph(),walkRequest());
 assert.deepEqual([...result.hopById],[['ent:alice',0],['ent:bob',1],['ent:carol',2]]);
 value.filters.direction='in';value.relations.forEach(relation=>{[relation.subject_id,relation.object_id]=[relation.object_id,relation.subject_id];});
 const incoming=parseNeighborhood(value,parseKnowledge(value,'current','alpha'),{...walkRequest(),walk:{direction:'in',hops:2}});
 assert.equal(incoming.relations[0].source,'ent:bob');assert.equal(incoming.relations[0].target,'ent:alice');
 assert.equal(incoming.hopById.get('ent:carol'),2);
});
test('walk settings reject bad direction or depth instead of silently widening',()=>{
 for(const walk of [{direction:'sideways',hops:2},{direction:'both',hops:0},{direction:'in',hops:9},{direction:'out',hops:1.5},{direction:'both',hops:NaN}]){
  assert.throws(()=>neighborhoodRequest(walkRequest().seeds,150,64,walk));
 }
 assert.deepEqual(neighborhoodRequest(walkRequest().seeds,150,64,{direction:'both',hops:null}).walk,{direction:'both',hops:null});
});
test('walk response must match requested direction and depth',()=>{
 for(const change of [(v:ReturnType<typeof walkFixture>)=>v.filters.direction='both',(v:ReturnType<typeof walkFixture>)=>v.filters.hops=1]){
  const value=walkFixture();change(value);assert.throws(()=>parseNeighborhood(value,graph(),walkRequest()));
 }
 assert.throws(()=>parseNeighborhood(fixture(),graph(),walkRequest()));
});
test('walk distances require bounded integer levels and directed predecessor evidence',()=>{
 for(const hops of [[1,1,2],[0,0,2],[0,1,3],[0,1,1],[0,1,NaN],[0,1,1.5],[0,2,1]]){
  const value=walkFixture();value.entities.forEach((entity,i)=>entity.hop=hops[i]);
  assert.throws(()=>parseNeighborhood(value,graph(),walkRequest()));
 }
 const reversed=walkFixture();reversed.relations[1].subject_id='ent:carol';reversed.relations[1].object_id='ent:bob';
 assert.throws(()=>parseNeighborhood(reversed,graph(),walkRequest()));
});
test('multiple starts have zero distance and a hub cannot be used as a predecessor',()=>{
 const value=walkFixture();value.filters.seeds.push('ent:carol');value.entities[2].hop=0;
 const seeds=[...walkRequest().seeds,{id:'ent:carol',key:'carol',label:'carol'}];
 assert.equal(parseNeighborhood(value,graph(),neighborhoodRequest(seeds,150,64,{direction:'out',hops:2})).hopById.get('ent:carol'),0);
 const hub=walkFixture();hub.filters.hub_degree=1;
 assert.throws(()=>parseNeighborhood(hub,graph(),{...walkRequest(),hubDegree:1}));
});

test('a direct seed shortcut cannot be reported as a longer distance',()=>{
 const value=walkFixture();value.relations.push({id:'rel:ac',subject_id:'ent:alice',object_id:'ent:carol',predicate:'knows',fact_ids:[3],support:{facts:1}});
 value.coverage.relations_total=3;value.coverage.relations_shown=3;
 assert.throws(()=>parseNeighborhood(value,graph(),walkRequest()));
 value.entities[2].hop=1;assert.equal(parseNeighborhood(value,graph(),walkRequest()).hopById.get('ent:carol'),1);
});

test('hidden hub degree can explain a longer route; a proven nonhub cannot',()=>{
 const value=walkFixture();value.filters.hub_degree=2;value.filters.hops=3;
 value.entities=[{...entity('alice'),claims:2,hop:0},{...entity('bob'),claims:100,hop:1},{...entity('carol'),claims:2,hop:3},{...entity('dana'),claims:2,hop:1},{...entity('eve'),claims:2,hop:2}];
 const rel=(a:string,b:string,n:number)=>({id:`rel:${a}-${b}`,subject_id:`ent:${a}`,object_id:`ent:${b}`,predicate:'knows',fact_ids:[n],support:{facts:1}});
 value.relations=[rel('alice','bob',1),rel('bob','carol',2),rel('alice','dana',3),rel('dana','eve',4),rel('eve','carol',5)];
 value.coverage={...value.coverage,entities_total:6,entities_shown:5,relations_total:6,relations_shown:5,truncated:true,reasons:['hub_skipped','outside_walk']};
 const request=neighborhoodRequest(walkRequest().seeds,150,2,{direction:'out',hops:3});
 assert.equal(parseNeighborhood(value,graph(),request).hopById.get('ent:carol'),3);
 value.entities[1].claims=2;assert.throws(()=>parseNeighborhood(value,graph(),request));
});

test('legacy exploration refuses explicit nondefault walk restrictions',()=>{
 const request=neighborhoodRequest(walkRequest().seeds,150,64);
 const value=walkFixture();assert.throws(()=>parseNeighborhood(value,graph(),request));
 value.filters.direction='both';assert.throws(()=>parseNeighborhood(value,graph(),request));
 const defaults={...value,filters:{...value.filters,hops:null}};
 assert.equal(parseNeighborhood(defaults,graph(),request).entities.length,3);
});
