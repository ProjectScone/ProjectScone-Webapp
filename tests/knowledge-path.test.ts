import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseKnowledgePath,pathNetwork} from '../src/memory/knowledge-path.ts';
import {parseEntitySearch,type Knowledge} from '../src/memory/knowledge.ts';
const projection={version:'v1',classifier:'c1',kinds:'k1',id_scheme:'id1',digest:'abc',revision:2};
const filters={status:'current',as_of:'2026-09-11T12:00:00Z'};
const graph:Knowledge={space:'alpha',identity:JSON.stringify(['v1','c1','k1','id1','abc']),revision:2,mode:'current',asOf:filters.as_of,entities:[],relations:[],attributes:[],analysis:null,coverage:{truncated:false,reasons:[],counts:{}}};
const name=(id:string)=>({id:'ent:'+id,key:id,label:id.toUpperCase()});
const policy={max_hops:4,limit:3,hub_degree:200};
const request={from:'ent:a',to:'ent:c',...policy};
const coverage={facts_read:2,facts_counted:2,facts_limit:50000,truncated:false,reasons:[] as string[]};
const fixture=()=>({schema_version:1,space:'alpha',projection,filters,policy,status:'found',complete:true,coverage:{...coverage},from:name('a'),to:name('c'),hubs_skipped:[],truncated:false,paths:[{entities:[name('a'),name('b'),name('c')],hops:[{relation_id:'rel:ab',subject:name('a'),predicate:'knows',object:name('b'),direction:'forward',fact_ids:[1]},{relation_id:'rel:cb',subject:name('c'),predicate:'reviews',object:name('b'),direction:'reverse',fact_ids:[2]}]}]});
test('paths retain original relationship direction and nodes beyond the initial map',()=>{
 const result=parseKnowledgePath(fixture(),graph,request),network=pathNetwork(result.paths[0]);
 assert.equal(result.paths[0].hops[1].direction,'reverse');assert.equal(network.edges[1].source,'ent:c');assert.equal(network.edges[1].target,'ent:b');assert.equal(network.nodes.length,3);
});
test('paths reject changed scope, projection, request bounds and broken hop chains',()=>{
 const changes=[(v:ReturnType<typeof fixture>)=>v.space='beta',(v:ReturnType<typeof fixture>)=>v.projection={...projection,revision:3},(v:ReturnType<typeof fixture>)=>v.policy={...policy,max_hops:8},(v:ReturnType<typeof fixture>)=>v.to=name('b'),(v:ReturnType<typeof fixture>)=>v.paths[0].hops[1].direction='forward',(v:ReturnType<typeof fixture>)=>v.paths[0].hops[0].fact_ids=[],(v:ReturnType<typeof fixture>)=>v.paths[0].entities[1]=name('a'),(v:ReturnType<typeof fixture>)=>v.status='disconnected'];
 for(const change of changes){const value=fixture();change(value);assert.throws(()=>parseKnowledgePath(value,graph,request));}
});
test('incomplete reads never support a conclusive disconnected response',()=>{
 const value={...fixture(),status:'not_connected_in_read',complete:false,paths:[],coverage:{...coverage,truncated:true,reasons:['fact_limit']}};
 assert.equal(parseKnowledgePath(value,graph,request).complete,false);
 assert.throws(()=>parseKnowledgePath({...value,status:'disconnected'},graph,request));
 assert.throws(()=>parseKnowledgePath({...value,complete:true},graph,request));
});
test('a path from an entity to itself has zero hops',()=>{
 const value={...fixture(),to:name('a'),paths:[{entities:[name('a')],hops:[]}]};
 assert.equal(parseKnowledgePath(value,graph,{...request,to:'ent:a'}).paths[0].hops.length,0);
});
test('entity search pins query, projection and counts while allowing off-map results',()=>{
 const value={schema_version:1,space:'alpha',projection,filters:{...filters,q:'outside'},entities:[{...name('outside'),kind:null,kind_status:'unknown',claims:1}],coverage:{...coverage,entities_total:1,entities_shown:1}};
 assert.equal(parseEntitySearch(value,graph,'outside').entities[0].id,'ent:outside');
 assert.throws(()=>parseEntitySearch(value,graph,'different'));
 assert.throws(()=>parseEntitySearch({...value,projection:{...projection,revision:3}},graph,'outside'));
 assert.throws(()=>parseEntitySearch({...value,coverage:{...value.coverage,entities_total:0}},graph,'outside'));
});
test('path records must agree with entities and relationships already in the map',()=>{
 const known={...graph,entities:[{...name('a'),kind:null,kindStatus:'unknown',claims:1}],relations:[{id:'rel:ab',source:'ent:a',target:'ent:b',predicate:'knows',factIds:[1],support:{}}]};
 assert.equal(parseKnowledgePath(fixture(),known,request).paths.length,1);
 const renamed=fixture();renamed.paths[0].entities[0].label='Someone else';renamed.paths[0].hops[0].subject.label='Someone else';assert.throws(()=>parseKnowledgePath(renamed,known,request));
 const changed=fixture();changed.paths[0].hops[0].fact_ids=[999];assert.throws(()=>parseKnowledgePath(changed,known,request));
});
