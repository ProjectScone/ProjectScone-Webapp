import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseKnowledge,parseEntityDetail,knowledgeNetwork} from '../src/memory/knowledge.ts';
const projection={version:'v',classifier:'c',kinds:'k',id_scheme:'i',digest:'d',revision:1};
const filters={status:'current',as_of:'2026-09-11T00:00:00.000Z'};
const entity=(id:string)=>({id,key:id,label:id,kind:null,kind_status:'unknown',claims:1});
const support={facts:2,active:2};
const meanings={inverse:{works_at:'employs',employs:'works_at'},symmetric:[],transitive:['part_of'],max_steps:4,max_implied:50000,max_walked:200000};
const implied=()=>({id:'imp:ac',subject_id:'ent:a',object_id:'ent:c',predicate:'part_of',fact_ids:[1,2],support,follows:'transitive',follows_from:['rel:ab','rel:bc'],periods:[['2024-01-01T00:00:00.000Z',null]],first_valid_from:'2024-01-01T00:00:00.000Z',last_valid_until:null});
function fixture(){return {schema_version:1,space:'alpha',projection,filters,entities:['ent:a','ent:c'].map(entity),relations:[],attributes:[],implied:[implied()],coverage:{facts_read:2,facts_counted:2,facts_limit:50000,entities_total:3,entities_shown:2,relations_total:2,relations_shown:0,attributes_total:0,attributes_shown:0,implied_total:1,implied_shown:1,meanings:structuredClone(meanings),truncated:true,reasons:['entity_limit']}};}
test('inferences retain their own identity and premises beyond the current page',()=>{
 const graph=parseKnowledge(fixture(),'current');
 assert.equal(graph.inference?.edges[0].id,'imp:ac');
 assert.deepEqual(graph.inference?.edges[0].premises,['rel:ab','rel:bc']);
 assert.equal(knowledgeNetwork(graph).edges.length,0,'asserted-only by default');
 assert.equal(knowledgeNetwork(graph,true).edges[0].kind,'implied');
});
test('malformed inference evidence cannot masquerade as recorded graph facts',()=>{
 const mutations:((v:ReturnType<typeof fixture>)=>void)[]=[v=>v.implied[0].id='rel:ac',v=>v.implied[0].object_id='ent:missing',v=>v.implied[0].follows='unknown',v=>v.implied[0].follows_from=[],v=>v.implied[0].fact_ids=[],v=>v.implied[0].fact_ids=[1,1],v=>v.implied[0].periods=[['2025-01-01T00:00:00.000Z','2024-01-01T00:00:00.000Z']],v=>v.implied[0].periods=[['2024-01-01T00:00:00.000Z',null],['2025-01-01T00:00:00.000Z',null]],v=>v.coverage.implied_shown=2,v=>v.coverage.meanings.transitive=[],v=>v.coverage.meanings.max_walked=0];
 for(const mutate of mutations){const value=fixture();mutate(value);assert.throws(()=>parseKnowledge(value,'current'));}
});
test('legacy graphs stay readable and unavailable inference coverage is distinct',()=>{
 const value=fixture() as Record<string,unknown>;delete value.implied;
 const coverage=value.coverage as Record<string,unknown>;delete coverage.meanings;delete coverage.implied_total;delete coverage.implied_shown;
 assert.equal(parseKnowledge(value,'current').inference,null);
});
test('entity inspection accepts only claims cited by its explicit premises',()=>{
 const graph=parseKnowledge(fixture(),'current');const edge=implied();
 const value={schema_version:1,space:'alpha',projection,filters,entity:entity('ent:a'),outgoing:[],incoming:[],attributes:[],follows:[{...edge,relation_id:edge.id,subject:entity('ent:a'),object:entity('ent:c')}],facts:[1,2].map(id=>({fact_id:id,subject:id===1?'A':'B',predicate:'part_of',object:id===1?'B':'C',status:'active',excluded:false,origin:'stated',source_episode_id:null,quote:null,grounding:'unsourced'})),consistent:true,complete:true,coverage:{facts_read:2,facts_counted:2,facts_limit:50000,relations_total:0,relations_shown:0,follows_shown:1,truncated:false,reasons:[]}};
 assert.equal(parseEntityDetail(value,graph,'ent:a').follows.length,1);
 assert.equal(parseEntityDetail(value,graph,'ent:a').facts.length,2);
 const mislabeled=structuredClone(value);mislabeled.follows[0].subject.label='Imposter';assert.throws(()=>parseEntityDetail(mislabeled,graph,'ent:a'));
 value.facts.push({...value.facts[0],fact_id:3});assert.throws(()=>parseEntityDetail(value,graph,'ent:a'));
});

test('visible premises must support the rule, direction and cited claims',()=>{
 const value=fixture();value.entities.push(entity('ent:b'));value.coverage.entities_shown=3;
 const relations=[{id:'rel:ab',subject_id:'ent:a',object_id:'ent:b',predicate:'part_of',fact_ids:[1],support:{facts:1,active:1}},{id:'rel:bc',subject_id:'ent:b',object_id:'ent:c',predicate:'part_of',fact_ids:[2],support:{facts:1,active:1}}];
 const payload={...value,relations,coverage:{...value.coverage,relations_shown:2}};
 assert.equal(parseKnowledge(payload,'current').inference?.edges.length,1);
 for(const mutate of [(v:typeof payload)=>v.relations[0].predicate='unrelated',(v:typeof payload)=>v.relations[0].subject_id='ent:b',(v:typeof payload)=>v.relations[1].fact_ids=[9]]){const changed=structuredClone(payload);mutate(changed);assert.throws(()=>parseKnowledge(changed,'current'));}
});


test('inference periods respect current and historical observation time',()=>{
 const future=fixture();future.implied[0].first_valid_from='2030-01-01T00:00:00.000Z';future.implied[0].periods=[[future.implied[0].first_valid_from,null]];
 assert.throws(()=>parseKnowledge(future,'current'));
 future.filters.status='history';assert.throws(()=>parseKnowledge(future,'history'));
 future.filters.status='all';assert.equal(parseKnowledge(future,'all').inference?.edges.length,1);
});
