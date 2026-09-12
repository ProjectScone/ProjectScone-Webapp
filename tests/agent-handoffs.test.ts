import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSavedPlan,validatePlan} from '../src/agents/plans.ts';
import {parseRunRequest,parseRunResult} from '../src/agents/runs.ts';
const plan={workflow_id:'report',root_agent:'research',max_handoffs:2,agents:[{agent_id:'research',model_id:'careful',can_handoff_to:['write']},{agent_id:'write',model_id:'fast',can_handoff_to:[]}]};
const catalog=plan.agents.map(agent=>({agent_id:agent.agent_id,default_model:agent.model_id,models:[{model_id:agent.model_id,label:agent.model_id,revision:'1'}]}));
const saved={space:'alpha',revision:1,updated_at:'2026-09-11T00:00:00Z',configuration_current:true,bindings:{research:'a'.repeat(64),write:'b'.repeat(64)},plan};
const snapshot={space:'alpha',run_id:'r',created_at:saved.updated_at,question:'Question',plan:saved,max_parallel:1};
const output=(index:number,agent_id='research',model_id='careful',binding='a'.repeat(64))=>({task_id:`hop-0${index}`,agent_id,model_id,binding,depends_on:index===1?[]:['hop-01'],text:agent_id+' answer',source_status:'none',evidence_ids:[],evidence_packets:[],model_calls:1,tool_calls:0});
const hops=[{output:output(1),handoff_to:'write'},{output:output(2,'write','fast','b'.repeat(64)),handoff_to:null}];
const result={space:'alpha',run_id:'r',status:'completed',hops,final:hops[1].output,reused_hops:[]};
test('handoff plan preserves root, selected models and allowed edges',()=>{
 assert.deepEqual(parseSavedPlan(saved,'alpha').plan,plan);
 assert.deepEqual(validatePlan(plan,catalog),plan);
 for(const changed of [{...plan,root_agent:'missing'},{...plan,max_handoffs:32},{...plan,tasks:[]},{...plan,agents:[{...plan.agents[0],can_handoff_to:['missing']},plan.agents[1]]}])assert.throws(()=>validatePlan(changed,catalog));
 assert.throws(()=>parseSavedPlan({...saved,bindings:{research:'a'.repeat(64)}},'alpha'));
 assert.throws(()=>parseRunRequest({...snapshot,max_parallel:2},'alpha','r'));
});
test('handoff output verifies every actual edge and selected binding',()=>{
 const request=parseRunRequest(snapshot,'alpha','r');
 const parsed=parseRunResult(result,request);
 assert.equal(parsed.tasks.length,2);assert.equal(parsed.outcome,'completed');assert.equal(parsed.finalTask,'hop-02');
 for(const change of [{model_id:'other'},{binding:'a'.repeat(64)},{depends_on:[]},{task_id:'hop-03'}])assert.throws(()=>parseRunResult({...result,hops:[hops[0],{...hops[1],output:{...hops[1].output,...change}}]},request));
 assert.throws(()=>parseRunResult({...result,hops:[{...hops[0],handoff_to:'research'},hops[1]]},request));
 assert.throws(()=>parseRunResult({...result,final:{...hops[1].output,text:'Substituted answer'}},request));
 assert.throws(()=>parseRunResult({...result,final:null},request));
});
test('budget exhaustion must be complete partial work with no final answer',()=>{
 const request=parseRunRequest({...snapshot,plan:{...saved,plan:{...plan,max_handoffs:0}}},'alpha','r');
 const partial={...result,status:'handoff_limit',hops:[hops[0]],final:null};
 assert.equal(parseRunResult(partial,request).outcome,'handoff_limit');
 assert.equal(parseRunResult(partial,request).finalTask,null);
 assert.throws(()=>parseRunResult({...partial,final:hops[0].output},request));
 assert.throws(()=>parseRunResult({...partial,status:'completed'},request));
 assert.throws(()=>parseRunResult(partial,parseRunRequest(snapshot,'alpha','r')));
});
test('handoff progress only permits the next hop after its completed prefix',async()=>{
 const {parseRunStatus,matchRun}=await import('../src/agents/runs.ts');
 const request=parseRunRequest(snapshot,'alpha','r');
 const status={space:'alpha',run_id:'r',created_at:snapshot.created_at,workflow_id:'report',plan_revision:1,status:'running',active_local:true,completed_steps:['hop-01'],inflight:'hop-02',inflight_steps:['hop-02'],max_parallel:1,outcome_unknown:false,error_class:null};
 matchRun(parseRunStatus(status,'alpha'),request);
 for(const id of ['hop-01','hop-03'])assert.throws(()=>matchRun(parseRunStatus({...status,inflight:id,inflight_steps:[id]},'alpha'),request));
});
