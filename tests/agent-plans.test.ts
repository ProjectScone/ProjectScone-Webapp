import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCatalog,parseSavedPlan,validatePlan,planAddress} from '../src/agents/plans.ts';
const choices=[{agent_id:'research',default_model:'local',models:[{model_id:'local',label:'Local model',revision:'1'}]}];
const plan={workflow_id:'report',tasks:[{task_id:'find',agent_id:'research',model_id:'local',prompt:'Find decisions',depends_on:[]}]};
const saved={space:'alpha',revision:1,plan,bindings:{find:'a'.repeat(64)},updated_at:'2026-09-11T00:00:00Z',configuration_current:true};
test('saved plan matches space and retains explicit model choice',()=>{
 const catalog=parseCatalog({agents:choices});
 assert.equal(parseSavedPlan(saved,'alpha').plan.tasks[0].model_id,'local');
 assert.deepEqual(validatePlan(plan,catalog),plan);
 assert.throws(()=>parseSavedPlan(saved,'bravo'));
 assert.throws(()=>parseSavedPlan({...saved,revision:Number.MAX_SAFE_INTEGER+1},'alpha'));
});
test('graphs refuse cycles, unknown dependencies and disallowed models',()=>{
 const catalog=parseCatalog({agents:choices});
 for(const task of [{...plan.tasks[0],depends_on:['find']},{...plan.tasks[0],depends_on:['missing']},{...plan.tasks[0],model_id:'unknown'}]){
  assert.throws(()=>validatePlan({...plan,tasks:[task]},catalog));
 }
 assert.throws(()=>validatePlan({...plan,tasks:[plan.tasks[0],plan.tasks[0]]},catalog));
 assert.throws(()=>validatePlan({...plan,tasks:[{...plan.tasks[0],prompt:'😀'.repeat(501)}]},catalog));
});
test('catalog validates choices and saved stale bindings remain inspectable',()=>{
 assert.throws(()=>parseCatalog({agents:[{...choices[0],default_model:'missing'}]}));
 assert.throws(()=>parseCatalog({agents:[choices[0],choices[0]]}));
 assert.equal(parseSavedPlan({...saved,configuration_current:false},'alpha').configuration_current,false);
 assert.throws(()=>parseSavedPlan({...saved,bindings:{}},'alpha'));
});
test('plan identifiers cannot normalize into another route',()=>{
 assert.equal(planAddress('report:one'),'/v1/agent-plans/report%3Aone');
 for(const id of ['.','..','a/b','a?b'])assert.throws(()=>planAddress(id));
});
test('save acknowledgement must preserve every selected task and model',async()=>{
 const {parseSavedEdit}=await import('../src/agents/plans.ts');
 assert.equal(parseSavedEdit(saved,'alpha',plan,0).revision,1);
 for(const change of [{model_id:'other'},{prompt:'Other instructions'},{agent_id:'other'}]){
  assert.throws(()=>parseSavedEdit({...saved,plan:{...plan,tasks:[{...plan.tasks[0],...change}]}},'alpha',plan,0));
 }
});
