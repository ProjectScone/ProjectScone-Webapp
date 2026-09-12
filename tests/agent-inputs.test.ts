import test from 'node:test';
import assert from 'node:assert/strict';
import {bindingIds,parseSavedPlan,validatePlan} from '../src/agents/plans.ts';
import {parseInputPage,validateResponse} from '../src/agents/inputs.ts';
import {parseRunRequest,parseRunResult,parseRunStatus,matchRun} from '../src/agents/runs.ts';
const plan={kind:'interactive',workflow_id:'w',tasks:[{kind:'input',task_id:'choose',prompt:'Choose',depends_on:[],max_response_bytes:32},{task_id:'answer',agent_id:'worker',model_id:'local',prompt:'Answer',depends_on:['choose']}]};
const catalog=[{agent_id:'worker',default_model:'local',models:[{model_id:'local',label:'Local',revision:'1'}]}];
const saved={space:'alpha',revision:1,plan,bindings:{answer:'a'.repeat(64)},configuration_current:true,updated_at:'2026-09-12T10:00:00Z'};
const request=parseRunRequest({space:'alpha',run_id:'one',plan:saved,question:'Question',created_at:saved.updated_at},'alpha','one');
const input={space:'alpha',run_id:'one',task_id:'choose',prompt:'Choose',context:'[]',max_response_bytes:32,revision:1,response:null,activation_id:null,created_at:saved.updated_at,responded_at:null};
test('interactive plans bind only model tasks and preserve explicit input bounds',()=>{
 assert.deepEqual(validatePlan(plan,catalog),plan);
 assert.deepEqual(bindingIds(parseSavedPlan(saved,'alpha').plan),['answer']);
 assert.throws(()=>validatePlan({...plan,tasks:[{...plan.tasks[0],max_response_bytes:true}]},catalog));
 assert.throws(()=>validatePlan({...plan,tasks:[plan.tasks[1]]},catalog));
 assert.throws(()=>validatePlan({...plan,tasks:[{...plan.tasks[0],model_id:'local'}]},catalog));
});
test('input pages bind prompt, scope, state and response byte limit',()=>{
 const page={space:'alpha',run_id:'one',items:[input]};
 assert.equal(parseInputPage(page,request)[0].task_id,'choose');
 for(const change of [{space:'other'},{prompt:'Changed'},{max_response_bytes:4000},{revision:2},{response:'Unactivated'}])assert.throws(()=>parseInputPage({...page,items:[{...input,...change}]},request));
 assert.deepEqual(validateResponse(input,'North'),{response:'North',expected_revision:1});
 assert.throws(()=>validateResponse(input,'é'.repeat(17)));
});
test('waiting task identities include human nodes without inventing model bindings',()=>{
 const status=parseRunStatus({space:'alpha',run_id:'one',workflow_id:'w',plan_revision:1,created_at:saved.updated_at,status:'awaiting_input',active_local:false,completed_steps:[],inflight:null,outcome_unknown:false,error_class:null,waiting_steps:['choose']},'alpha');
 matchRun(status,request);
 assert.throws(()=>matchRun({...status,waiting_steps:['missing']},request));
});
test('human results remain distinguishable from retained or model output',()=>{
 const human={kind:'human_input',task_id:'choose',depends_on:[],text:'North',activation_id:'c',response_digest:'b'.repeat(64)};
 const model={task_id:'answer',agent_id:'worker',model_id:'local',binding:'a'.repeat(64),depends_on:['choose'],text:'Answer',source_status:'none',evidence_ids:[],evidence_packets:[],model_calls:1,tool_calls:0};
 const value={space:'alpha',run_id:'one',status:'completed',reused_steps:[],results:{choose:human,answer:model}};
 assert.equal(parseRunResult(value,request).tasks[0].kind,'human_input');
 assert.throws(()=>parseRunResult({...value,results:{choose:{...human,source_status:'retained'},answer:model}},request));
});
