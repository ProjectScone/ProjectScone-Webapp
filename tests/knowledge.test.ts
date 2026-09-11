import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseKnowledge,parseEntityDetail,knowledgeNetwork} from '../src/memory/knowledge.ts';
const projection={version:'v1',classifier:'c1',kinds:'k1',id_scheme:'id1',digest:'abc',revision:2};
const entity=(id:string,label:string)=>({id,key:label,label,kind:null,kind_status:'unknown',claims:1});
const support={facts:1,active:1,closed:0,proposed:0,excluded:0,quoted:0,unquoted:0,unsourced:1,stated:1,extracted:0,inferred:0};
const fixture=()=>({schema_version:1,space:'alpha',projection,filters:{status:'current',as_of:'2026-09-11T12:00:00Z'},entities:[entity('ent:a','Alice'),entity('ent:b','Bob')],relations:[{id:'rel:ab',subject_id:'ent:a',object_id:'ent:b',predicate:'knows',fact_ids:[1],support}],attributes:[],coverage:{facts_read:1,facts_counted:1,facts_limit:50000,entities_total:2,entities_shown:2,relations_total:1,relations_shown:1,attributes_total:0,attributes_shown:0,truncated:false,reasons:[]}});
test('knowledge retains recorded edges and rejects changed scope and dangling endpoints',()=>{
 const graph=parseKnowledge(fixture(),'current','alpha');
 assert.throws(()=>parseKnowledge(fixture(),'current','beta'));
 assert.equal(knowledgeNetwork(graph).edges[0].data.predicate,'knows');
 assert.throws(()=>parseKnowledge(fixture(),'history'));
 const bad=fixture();bad.relations[0].object_id='ent:missing';assert.throws(()=>parseKnowledge(bad,'current'));
 const duplicate=fixture();duplicate.entities.push(duplicate.entities[0]);assert.throws(()=>parseKnowledge(duplicate,'current'));
});
test('knowledge rejects misleading counts and retains honest partial coverage',()=>{
 const bad=fixture();bad.coverage.entities_shown=3;assert.throws(()=>parseKnowledge(bad,'current'));
 const partial=fixture();partial.coverage.truncated=true;partial.coverage.reasons.push('fact_limit');
 assert.equal(parseKnowledge(partial,'current').coverage.truncated,true);
});
test('entity details must match the selected graph identity and never invent source evidence',()=>{
 const graph=parseKnowledge(fixture(),'current');
 const detail={schema_version:1,space:'alpha',projection,filters:fixture().filters,entity:fixture().entities[0],outgoing:[],incoming:[],attributes:[],facts:[],consistent:true,complete:true,coverage:{facts_read:1,facts_counted:1,facts_limit:50000,relations_total:0,relations_shown:0,truncated:false,reasons:[]}};
 assert.equal(parseEntityDetail(detail,graph,'ent:a').entity.label,'Alice');
 assert.throws(()=>parseEntityDetail({...detail,space:'beta'},graph,'ent:a'));
 assert.throws(()=>parseEntityDetail({...detail,projection:{...projection,revision:3}},graph,'ent:a'));
 assert.throws(()=>parseEntityDetail(detail,graph,'ent:b'));
});
test('coverage requires totals, consistent truncation and valid timestamps',()=>{
 const bad=fixture();delete (bad.coverage as Record<string,unknown>).entities_total;assert.throws(()=>parseKnowledge(bad,'current'));
 const missing=fixture();missing.coverage.reasons.push('fact_limit');assert.throws(()=>parseKnowledge(missing,'current'));
 const date=fixture();date.filters.as_of='not-a-date';assert.throws(()=>parseKnowledge(date,'current'));
});
test('one relationship can retain more than 5000 historical supporting claims',()=>{
 const value=fixture();value.filters.status='history';value.relations[0].fact_ids=Array.from({length:5001},(_,i)=>i+1);
 value.relations[0].support.facts=5001;value.coverage.facts_read=5001;value.coverage.facts_counted=5001;
 assert.equal(parseKnowledge(value,'history').relations[0].factIds.length,5001);
});
test('paged ledger metadata is additive to numeric coverage',()=>{
 const value=fixture();const coverage=value.coverage as Record<string,unknown>;coverage.read_mode='paged';
 assert.equal(parseKnowledge(value,'current').coverage.counts.facts_read,1);
 coverage.read_mode='unpaged';assert.equal(parseKnowledge(value,'current').coverage.truncated,false);
});
