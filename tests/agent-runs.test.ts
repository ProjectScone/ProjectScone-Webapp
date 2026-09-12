import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRunRequest,parseRunStatus,parseRunResult,runAddress,validateStart,matchRun} from '../src/agents/runs.ts';
const task={task_id:'find',agent_id:'research',model_id:'careful',prompt:'Find evidence',depends_on:[]};
const snapshot={space:'alpha',run_id:'run-1',created_at:'2026-09-11T00:00:00Z',cancel_requested_at:null,question:'What happened?',scope:{},exclude_session_id:null,plan:{space:'alpha',revision:1,updated_at:'2026-09-11T00:00:00Z',plan:{workflow_id:'report',tasks:[task]},bindings:{find:'a'.repeat(64)}}};
const status={space:'alpha',run_id:'run-1',created_at:snapshot.created_at,workflow_id:'report',plan_revision:1,status:'completed',active_local:false,completed_steps:['find'],inflight:null,outcome_unknown:false,error_class:null};
const receipt={...task,binding:'a'.repeat(64),text:'Answer <script>ignored</script>',source_status:'none',evidence_ids:[],evidence_packets:[],model_calls:1,tool_calls:0};
const result={space:'alpha',run_id:'run-1',status:'completed',results:{find:receipt},reused_steps:[]};
test('run reads bind original space, identifier and model snapshot',()=>{
 const request=parseRunRequest(snapshot,'alpha','run-1');
 assert.equal(parseRunStatus(status,'alpha','run-1').status,'completed');
 assert.equal(parseRunResult(result,request).tasks[0].model_id,'careful');
 assert.throws(()=>parseRunRequest(snapshot,'bravo','run-1'));
 assert.throws(()=>parseRunStatus(status,'alpha','different'));
 assert.throws(()=>parseRunResult({...result,space:'bravo'},request));
 for(const change of [{binding:'b'.repeat(64)},{model_id:'fast'},{agent_id:'other'},{depends_on:['missing']},{source_status:'retained'}]){
  assert.throws(()=>parseRunResult({...result,results:{find:{...receipt,...change}}},request));
 }
 assert.throws(()=>parseRunResult({...result,results:{}},request));
});
test('run admission has bounded question and explicit saved revision',()=>{
 assert.deepEqual(validateStart('run-1','report',1,'What happened?'),{run_id:'run-1',workflow_id:'report',plan_revision:1,question:'What happened?'});
 for(const question of ['','  ','😀'.repeat(1001)])assert.throws(()=>validateStart('run-1','report',1,question));
 assert.throws(()=>validateStart('run-1','report',0,'Question'));
 assert.throws(()=>runAddress('..'));
 assert.throws(()=>parseRunStatus({...status,outcome_unknown:'false'},'alpha'));
 assert.throws(()=>parseRunRequest({...snapshot,plan:{...snapshot.plan,bindings:{find:'bad'}}},'alpha','run-1'));
});

test('native UTC serializers match and deadline states remain inspectable',()=>{
 const request=parseRunRequest(snapshot,'alpha','run-1');
 matchRun(parseRunStatus({...status,created_at:'2026-09-11T00:00:00+00:00'},'alpha'),request);
 for(const state of ['created','deadline','outcome_unknown','retry_not_allowed'])assert.equal(parseRunStatus({...status,status:state},'alpha').status,state);
});
test('submitted run cannot substitute a different question, task or model binding',async()=>{
 const {matchSubmission}=await import('../src/agents/runs.ts');
 const expected={space:'alpha',run_id:'run-1',question:snapshot.question,revision:1,plan:snapshot.plan.plan,bindings:snapshot.plan.bindings,max_parallel:1};
 const request=parseRunRequest(snapshot,'alpha','run-1');matchSubmission(request,expected);
 assert.throws(()=>matchSubmission({...request,question:'A different question'},expected));
 assert.throws(()=>matchSubmission({...request,plan:{...request.plan,tasks:[{...task,model_id:'fast'}]}},expected));
 assert.throws(()=>matchSubmission({...request,bindings:{find:'b'.repeat(64)}},expected));
});

test('parallel policy and invocation limits are validated and bound',async()=>{
 const {parseRunPolicy,matchSubmission}=await import('../src/agents/runs.ts');
 assert.equal(parseRunPolicy({space:'alpha',max_parallel_tasks:2,max_active_runs:4},'alpha'),2);
 assert.throws(()=>parseRunPolicy({space:'bravo',max_parallel_tasks:2,max_active_runs:4},'alpha'));
 assert.throws(()=>parseRunPolicy({space:'alpha',max_parallel_tasks:9,max_active_runs:4},'alpha'));
 const request=parseRunRequest(snapshot,'alpha','run-1');
 assert.throws(()=>matchSubmission({...request,max_parallel:2},request));
 assert.throws(()=>matchRun(parseRunStatus({...status,max_parallel:2},'alpha'),request));
 assert.equal(validateStart('r','report',1,'Question',2).max_parallel,2);
 assert.throws(()=>parseRunStatus({...status,inflight:'find',inflight_steps:[]},'alpha'));
});
test('in-flight task inventory cannot exceed the recorded parallel bound',()=>{
 assert.throws(()=>parseRunStatus({...status,status:'running',active_local:true,completed_steps:[],inflight:'find',inflight_steps:['find','other'],max_parallel:1},'alpha'));
});
