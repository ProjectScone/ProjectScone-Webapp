import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseKnowledgeTimeline,timelineExtent} from '../src/memory/knowledge-timeline.ts';
import type {Knowledge} from '../src/memory/knowledge.ts';
const projection={version:'v',classifier:'c',kinds:'k',id_scheme:'i',digest:'all-digest',revision:1};
const graph:Knowledge={space:'alpha',identity:JSON.stringify(['v','c','k','i','current-digest']),revision:1,mode:'current',asOf:'2026-06-01T00:00:00.000Z',entities:[],relations:[],attributes:[],analysis:null,coverage:{truncated:false,reasons:[],counts:{}}};
const fixture=()=>({schema_version:1,space:'alpha',projection,as_of:graph.asOf,consistent:true,entity:{id:'ent:a',key:'alice',label:'Alice',kind:'person'},lanes:[{id:'subject:works_at',role:'subject',predicate:'works_at',items:[1,2]}],items:[{fact_id:1,role:'subject',subject:'alice',predicate:'works_at',object:'Acme',far:{id:'ent:b',key:'acme',label:'Acme'},valid_from:'2024-01-01T00:00:00.000Z',valid_until:'2025-01-01T00:00:00.000Z',status:'closed',excluded:false,origin:'stated',superseded_by:2,source_episode_id:7,grounding:'quote_verified',quote:'Alice joined Acme.',holds_at_as_of:false},{fact_id:2,role:'subject',subject:'alice',predicate:'works_at',object:'Beta',far:{id:'ent:c',key:'beta',label:'Beta'},valid_from:'2025-01-01T00:00:00.000Z',valid_until:null,status:'active',excluded:false,origin:'stated',superseded_by:null,source_episode_id:null,grounding:'unsourced',quote:null,holds_at_as_of:true}],relations:[{kind:'superseded_by',from_fact:1,to_fact:2}],coverage:{items_total:2,items_shown:2,truncated:false,reasons:[],read:{facts_read:2,facts_counted:2,facts_limit:50000,reasons:[]}}});
test('timeline accepts its all-history digest while pinning revision, entity and time',()=>{const t=parseKnowledgeTimeline(fixture(),graph,'ent:a',graph.asOf);assert.equal(t.items[0].sourceId,7);assert.equal(t.items[1].holds,true);assert.equal(t.items[0].until,Date.parse('2025-01-01T00:00:00Z'));});
test('timeline rejects changed scope, ignored time, inconsistent read and incorrect held marker',()=>{for(const mutate of [(v:ReturnType<typeof fixture>)=>v.space='other',(v:ReturnType<typeof fixture>)=>v.as_of='2026-07-01T00:00:00.000Z',(v:ReturnType<typeof fixture>)=>v.projection={...projection,revision:2},(v:ReturnType<typeof fixture>)=>v.consistent=false,(v:ReturnType<typeof fixture>)=>v.items[0].holds_at_as_of=true,(v:ReturnType<typeof fixture>)=>v.lanes[0].items=[1],(v:ReturnType<typeof fixture>)=>v.relations[0].to_fact=3]){const v=fixture();mutate(v);assert.throws(()=>parseKnowledgeTimeline(v,graph,'ent:a',graph.asOf));}});
test('timeline uses half-open validity and has a finite axis for empty and open intervals',()=>{const v=fixture(),when='2025-01-01T00:00:00.000Z';v.as_of=when;const t=parseKnowledgeTimeline(v,graph,'ent:a',when);assert.equal(t.items[0].holds,false);assert.equal(t.items[1].holds,true);for(const items of [t.items,[]]){const [start,end]=timelineExtent(items,t.asOf);assert.ok(Number.isFinite(start)&&Number.isFinite(end)&&start<end);}});
test('timeline rejects impossible dates instead of normalizing them onto the axis',()=>{
 const v=fixture();v.items[0].valid_from='2024-02-30T00:00:00.000Z';
 assert.throws(()=>parseKnowledgeTimeline(v,graph,'ent:a',graph.asOf));
});
test('timeline cannot change a known canonical entity key across claim modes',()=>{
 const known={...graph,entities:[{id:'ent:a',key:'alice',label:'Alice',kind:'person',kindStatus:'known',claims:2}]};
 const value=fixture();value.entity.key='mallory';value.entity.label='Mallory invented';
 assert.throws(()=>parseKnowledgeTimeline(value,known,'ent:a',graph.asOf));
 const historicalLabel=fixture();historicalLabel.entity.label='ALICE';
 assert.equal(parseKnowledgeTimeline(historicalLabel,known,'ent:a',graph.asOf).entity.key,'alice');
});
test('timeline enforces the requested record limit',()=>{
 assert.throws(()=>parseKnowledgeTimeline(fixture(),graph,'ent:a',graph.asOf,1));
});
