import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCatalog} from '../src/agents/plans.ts';

const agent={agent_id:'worker',default_model:'local',models:[{model_id:'local',label:'Local',revision:'1'}]};
const tool={name:'count',description:'Count local records.',revision:'1'};
const packet=()=>({agents:[{...agent,tools:['count']}],tools:[{...tool}]});

test('legacy unknown and explicit empty application tools remain distinct',()=>{
 assert.equal(parseCatalog({agents:[agent]})[0].tools,undefined);
 assert.deepEqual(parseCatalog({agents:[{...agent,tools:[]}],tools:[]})[0].tools,[]);
});
test('shared tool metadata resolves per agent and stays detached',()=>{
 const source=packet();
 const result=parseCatalog({...source,agents:[source.agents[0],{...agent,agent_id:'second',tools:['count']}]});
 assert.deepEqual(result[0].tools,[tool]);
 source.tools[0].description='Changed';
 assert.equal(result[0].tools?.[0].description,tool.description);
});
test('partial new catalog shapes and malformed metadata fail closed',()=>{
 for(const value of [
  {agents:[{...agent,tools:[]}]},{agents:[agent],tools:[]},
  {...packet(),tools:null},{...packet(),tools:false},{...packet(),tools:[tool,tool]},
  {...packet(),agents:[{...agent,tools:null}]},{...packet(),agents:[{...agent,tools:['missing']}]},
  {...packet(),agents:[{...agent,tools:['count','count']}]},
  ...['answer','search_memory','bad.name','x'.repeat(65)].map(name=>({...packet(),tools:[{...tool,name}]})),
  ...[' ', 'é'.repeat(2001),'\ud800'].map(description=>({...packet(),tools:[{...tool,description}]})),
  {...packet(),tools:[{...tool,parameters:{}}]}, {...packet(),tools:[{...tool,revision:false}]},
 ])assert.throws(()=>parseCatalog(value));
});
test('metadata has bounded counts and aggregate UTF-8 bytes',()=>{
 const tools=Array.from({length:32},(_,i)=>({...tool,name:'tool_'+i,description:'x'.repeat(3900)}));
 const agents=[{...agent,tools:tools.map(tool=>tool.name)}];
 assert.equal(parseCatalog({agents,tools})[0].tools?.length,32);
 assert.throws(()=>parseCatalog({agents,tools:[...tools,{...tool,name:'extra'}]}));
 assert.throws(()=>parseCatalog({agents,tools:tools.map(tool=>({...tool,description:'x'.repeat(4000)}))}));
});
test('prototype-like tool names use ordinary entries and descriptions stay literal',()=>{
 const description='<img src=x onerror=alert(1)> 😀';
 const result=parseCatalog({agents:[{...agent,tools:['__proto__']}],tools:[{...tool,name:'__proto__',description}]});
 assert.equal(result[0].tools?.[0].description,description);
});
