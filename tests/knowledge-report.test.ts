import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseKnowledgeReport} from '../src/memory/knowledge-report.ts';
import {parseKnowledgeAnalysis} from '../src/memory/knowledge-analysis.ts';
import type {Knowledge} from '../src/memory/knowledge.ts';
const projection={version:'v',classifier:'c',kinds:'k',id_scheme:'i',digest:'d',revision:1};
const graph:Knowledge={space:'alpha',identity:JSON.stringify(['v','c','k','i','d']),revision:1,mode:'current',asOf:'2026-09-11T12:00:00Z',entities:[],relations:[],attributes:[],analysis:null,coverage:{truncated:false,reasons:[],counts:{}}};
const person=(id:string)=>({id:'ent:'+id,key:id,label:id});
const coverage=()=>({entities_total:2,entities_analysed:2,isolated_entities:0,truncated:false,reasons:[],betweenness:'exact',betweenness_estimated:false,levels:1,resolution:2});
const fixture=()=>({schema_version:1,space:'alpha',projection,filters:{status:'current',as_of:graph.asOf},analysis:{version:'a',basis:'computed',modularity:-.5,resolution:2,exclude_hubs:95,betweenness:'exact',coverage:coverage()},summary:{entities:2,relations:1,attributes:0,communities:1,isolated_entities:0},communities:[{id:'com:a',label:'a',size:2,central:[person('a')],internal_links:1,boundary_links:0,cohesion:1,kinds:[['person',2]],predicates:[['knows',1]]}],central_entities:[{...person('a'),kind:'person',community_id:'com:a',community:'a',degree:1,weight:1,pagerank:.5,betweenness:0,participation:0}],hubs_excluded:[],bridging_entities:[],surprising_connections:[],suggestions:[{kind:'connection',text:'How are these related?',entity_ids:['ent:a','ent:b'],relation_ids:['rel:ab'],fact_ids:[1]}],coverage:{facts_read:1,facts_counted:1,facts_limit:50000,entities_analysed:2,truncated:false,reasons:[]}});
test('report retains computed settings, structure and question support outside the map',()=>{
 const value=parseKnowledgeReport(fixture(),graph,{resolution:2,excludeHubs:95});assert.equal(value.resolution,2);assert.equal(value.excludeHubs,95);assert.deepEqual(value.suggestions[0].factIds,[1]);assert.equal(value.communities[0].size,2);
});
test('report rejects changed context, ignored controls and invalid community references',()=>{
 for(const mutate of [(v:ReturnType<typeof fixture>)=>v.space='other',(v:ReturnType<typeof fixture>)=>v.projection={...projection,revision:2},(v:ReturnType<typeof fixture>)=>v.analysis.resolution=1,(v:ReturnType<typeof fixture>)=>v.analysis.exclude_hubs=90,(v:ReturnType<typeof fixture>)=>v.central_entities[0].community_id='com:missing',(v:ReturnType<typeof fixture>)=>v.summary.communities=2]){const v=fixture();mutate(v);assert.throws(()=>parseKnowledgeReport(v,graph,{resolution:2,excludeHubs:95}));}
});
test('resolution-weighted modularity can be below minus one',()=>{
 const value={basis:'computed',method:'analysis',modularity:-5,communities:[{id:'com:a',label:'a',size:2,members:['ent:a','ent:b']}],membership:{'ent:a':'com:a','ent:b':'com:a'},importance:['ent:a','ent:b'].map(entity_id=>({entity_id,community_id:'com:a',degree:1,pagerank:.5,betweenness:0,participation:0})),coverage:{...coverage(),resolution:10}};
 assert.equal(parseKnowledgeAnalysis(value,new Set(['ent:a','ent:b'])).modularity,-5);
});
test('report names and community labels agree with identities already returned',()=>{
 const known={...graph,entities:[{...person('a'),kind:'person',kindStatus:'known',claims:1}]};
 const wrongName=fixture();wrongName.central_entities[0].label='Invented identity';
 assert.throws(()=>parseKnowledgeReport(wrongName,known,{resolution:2,excludeHubs:95}));
 const wrongGroup=fixture();wrongGroup.central_entities[0].community='Invented group';
 assert.throws(()=>parseKnowledgeReport(wrongGroup,graph,{resolution:2,excludeHubs:95}));
});
test('report rejects malformed scores, support and undisclosed analysis limits',()=>{
 const mutate:Array<(v:Record<string,unknown>)=>void>=[
  v=>{(v.analysis as Record<string,unknown>).modularity=-3;},
  v=>{const a=v.analysis as Record<string,unknown>;a.betweenness='sampled:5';},
  v=>{const a=v.analysis as Record<string,unknown>;const c=a.coverage as Record<string,unknown>;c.truncated=true;c.reasons=['entity_limit'];},
  v=>{const q=(v.suggestions as Array<Record<string,unknown>>)[0];q.fact_ids=[0];},
  v=>{const q=(v.suggestions as Array<Record<string,unknown>>)[0];q.fact_ids=[1,1];},
  v=>{const q=(v.suggestions as Array<Record<string,unknown>>)[0];q.entity_ids=['missing-prefix'];},
  v=>{const c=(v.communities as Array<Record<string,unknown>>)[0];c.size=3;},
 ];
 for(const change of mutate){const v=fixture();change(v);assert.throws(()=>parseKnowledgeReport(v,graph,{resolution:2,excludeHubs:95}));}
});
