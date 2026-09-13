import test from 'node:test';
import assert from 'node:assert/strict';
import {parseApprovalPage,parseApproval,matchDecision,prepareContinuation,matchContinuation} from '../src/agents/approvals.ts';
import {parseRunRequest,parseRunStatus,matchRun} from '../src/agents/runs.ts';
import {request,pending,decided,status,page,call,time} from './fixtures/agent-approval-data.ts';
test('literal arguments preserve large integers, decimal formatting and Unicode',()=>{
 for(const arguments_json of ['{"count":123456789012345678901234567890}', '{"amount":1.0,"small":1e-07}', '{"😀":"hello","空":[]}']){
  const parsed=parseApproval({...pending,call:{...call,arguments_json}},request);
  assert.equal(parsed.call.arguments_json,arguments_json);
 }
 assert.equal(parseApproval(pending,request).call.tool_revision,'.');
});
test('refuse substituted models, bindings, fields and ambiguous argument objects',()=>{
 for(const change of [{model_id:'fast'},{step_id:'other'},{binding:'f'.repeat(64)},{tool_name:'search_memory'},
  {arguments_json:'{"x":1,"x":2}'},{arguments_json:'{"x":NaN}'},{arguments_json:'{"x":'+ '1'.repeat(100)+'}'},
  {arguments_json:'{"x":'+'['.repeat(34)+'0'+']'.repeat(34)+'}'},{arguments_json:'[]'}]){
  assert.throws(()=>parseApproval({...pending,call:{...call,...change}},request));
 }
 for(const change of [{revision:true},{revision:2},{space:'other'},{decision:'approve'},{created_at:'2026-09-13'}, {extra:true}])assert.throws(()=>parseApproval({...pending,...change},request));
 assert.throws(()=>parseApprovalPage(page([pending,pending]),request));
});
test('decision acknowledgement cannot change the exact call or chosen decision',()=>{
 const p=parseApproval(pending,request),d=parseApproval(decided,request);
 matchDecision(d,p,'approve');
 assert.throws(()=>matchDecision(d,p,'deny'));
 assert.throws(()=>matchDecision(parseApproval({...decided,call:{...call,arguments_json:'{"message":"Changed"}'}},request),p,'approve'));
});
test('activation requires exact immutable selected decision hashes and one batch',()=>{
 const d=parseApproval(decided,request),body=prepareContinuation([d],[d.request_id],'next');
 const activation={space:'alpha',run_id:'one',activation_id:'next',created_at:time,decisions:{[d.request_id]:2},decision_digests:{[d.request_id]:d.decision_digest}};
 matchContinuation({status,activation},request,body,[d]);
 for(const change of [{activation_id:'other'},{decisions:{}},{decision_digests:{[d.request_id]:'f'.repeat(64)}},{run_id:'other'}])assert.throws(()=>matchContinuation({status,activation:{...activation,...change}},request,body,[d]));
 assert.throws(()=>prepareContinuation([d],[],'next'));
 assert.throws(()=>prepareContinuation([d],[d.request_id,d.request_id],'next'));
 assert.throws(()=>prepareContinuation([parseApproval(pending,request)],[d.request_id],'next'));
});
test('saved activation retries preserve their exact original group',()=>{
 const activated=parseApproval({...decided,revision:3,activation_id:'next',activated_at:time},request);
 assert.equal(prepareContinuation([activated],[activated.request_id],'next').continuation_id,'next');
 assert.throws(()=>prepareContinuation([activated],[activated.request_id],'different'));
});
test('paused steps are disjoint model tasks, not unknown or completed execution',()=>{
 const parsed=parseRunStatus(status,'alpha');matchRun(parsed,request);assert.deepEqual(parsed.paused_steps,['send']);
 for(const change of [{paused_steps:[]},{paused_steps:['other']},{paused_steps:['send','send']},{completed_steps:['send']},{status:'completed'},{outcome_unknown:true}])assert.throws(()=>matchRun(parseRunStatus({...status,...change},'alpha'),request));
});
