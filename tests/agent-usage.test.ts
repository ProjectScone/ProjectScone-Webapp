import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTokenUsage,tokenUsageRows} from '../src/agents/usage.ts';
import {parseRunRequest,parseRunResult} from '../src/agents/runs.ts';
const count={prompt_tokens:10,completion_tokens:2,total_tokens:12};
const task={task_id:'find',agent_id:'research',model_id:'careful',prompt:'Find evidence',depends_on:[]};
const snapshot={space:'alpha',run_id:'run-1',created_at:'2026-09-11T00:00:00Z',cancel_requested_at:null,question:'What happened?',scope:{},exclude_session_id:null,plan:{space:'alpha',revision:1,updated_at:'2026-09-11T00:00:00Z',plan:{workflow_id:'report',tasks:[task]},bindings:{find:'a'.repeat(64)}}};
const request=parseRunRequest(snapshot,'alpha','run-1');
const receipt={...task,binding:'a'.repeat(64),text:'Answer',source_status:'none',evidence_ids:[],evidence_packets:[],model_calls:1,tool_calls:0};
function result(output:unknown){return {space:'alpha',run_id:'run-1',status:'completed',results:{find:output},reused_steps:['find']};}

test('negotiated model usage is typed and reused task remains identifiable',()=>{
 const parsed=parseRunResult(result({...receipt,usage:{calls:[count]}}),request,true);
 assert.deepEqual(parsed.tasks[0].usage,{calls:[count]});
 assert.deepEqual(parsed.reusedTasks,['find']);
 assert.equal(parseRunResult(result({...receipt,usage:null}),request,true).tasks[0].usage,null);
 assert.throws(()=>parseRunResult(result(receipt),request,true));
 assert.throws(()=>parseRunResult(result({...receipt,usage:{calls:[count]}}),request));
});

test('unknown coverage never looks like zero or a complete subtotal',()=>{
 const parsed=parseTokenUsage({calls:[count,{prompt_tokens:20,completion_tokens:null,total_tokens:null}]},2);
 assert.deepEqual(tokenUsageRows(parsed),[
  {label:'Prompt',tokens:30,reportedCalls:2,modelCalls:2},
  {label:'Completion',tokens:null,reportedCalls:1,modelCalls:2},
  {label:'Total',tokens:null,reportedCalls:1,modelCalls:2},
 ]);
 assert.equal(tokenUsageRows(parseTokenUsage({calls:[{prompt_tokens:0,completion_tokens:0,total_tokens:0}]},1))[2].tokens,0);
});

for(const malformed of [undefined,{},[],{calls:[]},{calls:[count,count]},{calls:[{...count,total_tokens:11}]},
 {calls:[{...count,prompt_tokens:true}]},{calls:[{...count,prompt_tokens:'10'}]},
 {calls:[{...count,prompt_tokens:1.2}]},{calls:[{...count,prompt_tokens:-1}]},
 {calls:[{...count,prompt_tokens:1_000_000_001}]},{calls:[{...count,prompt_tokens:NaN}]},
 {calls:[{...count,prompt_tokens:Infinity}]},{calls:[{prompt_tokens:10}]},
 {calls:[{...count,private:'SECRET'}]},{calls:[count],total_tokens:12}]){
 test('malformed usage refuses '+JSON.stringify(malformed),()=>assert.throws(()=>parseTokenUsage(malformed,1)));
}

test('native maximum totals remain safe integers and detached',()=>{
 const raw={calls:Array.from({length:17},()=>({prompt_tokens:1e9,completion_tokens:0,total_tokens:1e9}))};
 const parsed=parseTokenUsage(raw,17);raw.calls[0].total_tokens=0;
 assert.equal(tokenUsageRows(parsed)[2].tokens,17e9);
 assert.throws(()=>parseTokenUsage({...raw,calls:[...raw.calls,count]},18));
});
