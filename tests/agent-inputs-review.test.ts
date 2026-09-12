import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRunRequest,parseRunResult,parseRunStatus,matchRun} from '../src/agents/runs.ts';
import {parseInputPage,matchInputResults,matchInputActivation} from '../src/agents/inputs.ts';
const plan={kind:'interactive',workflow_id:'w',tasks:[{kind:'input',task_id:'choose',prompt:'Choose',depends_on:[],max_response_bytes:32},{task_id:'answer',agent_id:'worker',model_id:'local',prompt:'Answer',depends_on:['choose']}]};
const saved={space:'alpha',revision:1,plan,bindings:{answer:'a'.repeat(64)},configuration_current:true,updated_at:'2026-09-12T10:00:00Z'};
const request=parseRunRequest({space:'alpha',run_id:'one',plan:saved,question:'Question',created_at:saved.updated_at},'alpha','one');
const input={space:'alpha',run_id:'one',task_id:'choose',prompt:'Choose',context:'[]',max_response_bytes:32,revision:3,response:'North',activation_id:'c',created_at:saved.updated_at,responded_at:saved.updated_at};
const inputs=parseInputPage({space:'alpha',run_id:'one',items:[input]},request);
const human={kind:'human_input',task_id:'choose',depends_on:[],text:'North',activation_id:'c',response_digest:'b'.repeat(64)};
const model={task_id:'answer',agent_id:'worker',model_id:'local',binding:'a'.repeat(64),depends_on:['choose'],text:'Answer',source_status:'none',evidence_ids:[],evidence_packets:[],model_calls:1,tool_calls:0};
const result={space:'alpha',run_id:'one',status:'completed',reused_steps:[],results:{choose:human,answer:model}};
test('human results bind the freshly verified reply and explicit activation',()=>{
 assert.doesNotThrow(()=>matchInputResults(parseRunResult(result,request),inputs));
 for(const mutation of [{text:'South'},{activation_id:'other'}]){
  const parsed=parseRunResult({...result,results:{...result.results,choose:{...human,...mutation}}},request);
  assert.throws(()=>matchInputResults(parsed,inputs));
 }
 assert.throws(()=>matchInputResults(parseRunResult(result,request),[]));
 const unanswered=parseInputPage({space:'alpha',run_id:'one',items:[{...input,revision:2,activation_id:null}]},request);
 assert.throws(()=>matchInputResults(parseRunResult(result,request),unanswered));
});
test('human tasks cannot be reported as model work in flight',()=>{
 const status=parseRunStatus({space:'alpha',run_id:'one',workflow_id:'w',plan_revision:1,created_at:saved.updated_at,status:'running',active_local:true,completed_steps:[],inflight:'choose',inflight_steps:['choose'],outcome_unknown:false,error_class:null,waiting_steps:[]},'alpha');
 assert.throws(()=>matchRun(status,request));
});

test('continuation acknowledgement binds exact activated task group and saved replies',()=>{
 const other={...input,task_id:'other',prompt:'Other choice'};
 const expanded={...plan,tasks:[...plan.tasks,{...plan.tasks[0],task_id:'other',prompt:'Other choice'}]};
 const expandedRequest=parseRunRequest({space:'alpha',run_id:'one',plan:{...saved,plan:expanded},question:'Question',created_at:saved.updated_at},'alpha','one');
 const page=(items:unknown[])=>parseInputPage({space:'alpha',run_id:'one',items},expandedRequest);
 const prior=page([{...input,revision:2,activation_id:null},{...other,revision:2,activation_id:null}]);
 const continuation={continuation_id:'c',responses:{choose:2}};
 assert.doesNotThrow(()=>matchInputActivation(page([input,{...other,revision:2,activation_id:null}]),continuation,prior));
 for(const rows of [
  [{...input,revision:2,activation_id:null},other],
  [input,other],
  [{...input,response:'Changed reply'},{...other,revision:2,activation_id:null}],
  [{...input,activation_id:'different'},{...other,revision:2,activation_id:null}],
 ])assert.throws(()=>matchInputActivation(page(rows),continuation,prior));
});
