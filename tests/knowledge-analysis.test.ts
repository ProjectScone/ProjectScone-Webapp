import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseKnowledgeAnalysis,analysisGroups} from '../src/memory/knowledge-analysis.ts';
const fixture=()=>({basis:'computed',method:'scone.analysis/1',modularity:.4,membership:{'ent:a':'com:one','ent:b':'com:one'},communities:[{id:'com:one',label:'Alpha',members:['ent:a','ent:b'],size:3}],importance:['ent:a','ent:b'].map(entity_id=>({entity_id,community_id:'com:one',degree:1,pagerank:.5,betweenness:.25,participation:0})),coverage:{entities_total:501,entities_analysed:500,isolated_entities:1,truncated:false,reasons:[],betweenness:'sampled:64',betweenness_estimated:true,levels:2}});
test('computed communities retain analysis sampling and visible versus whole community sizes',()=>{const analysis=parseKnowledgeAnalysis(fixture(),new Set(['ent:a','ent:b','ent:c']));assert.equal(analysis.estimated,true);assert.equal(analysis.communities[0].size,3);assert.equal(analysis.communities[0].members.length,2);assert.equal(analysisGroups(analysis,['ent:a','ent:b','ent:c']).groups.at(-1)?.label,'No group returned');});
test('analysis rejects fabricated membership, duplicate assignment and contradictory sampling',()=>{
 for(const change of [(v:ReturnType<typeof fixture>)=>v.membership['ent:a']='com:missing',(v:ReturnType<typeof fixture>)=>v.communities[0].members.push('ent:outside'),(v:ReturnType<typeof fixture>)=>v.communities[0].members.push('ent:a'),(v:ReturnType<typeof fixture>)=>v.coverage.betweenness_estimated=false,(v:ReturnType<typeof fixture>)=>v.importance[0].pagerank=Infinity]){const v=fixture();change(v);assert.throws(()=>parseKnowledgeAnalysis(v,new Set(['ent:a','ent:b'])));}
});
test('isolated entities are separate from the connected analysis population',()=>{
 const value={basis:'computed',method:'scone.analysis/1',modularity:0,membership:{},communities:[],importance:[],coverage:{entities_total:0,entities_analysed:0,isolated_entities:1,truncated:false,reasons:[],betweenness:'exact',betweenness_estimated:false,levels:0}};
 const analysis=parseKnowledgeAnalysis(value,new Set(['ent:literal']));
 assert.equal(analysis.total,0);assert.equal(analysis.isolated,1);
 assert.deepEqual(analysisGroups(analysis,['ent:literal']).groups[0].nodeIds,['ent:literal']);
});
