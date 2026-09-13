import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOutputRequirements,requireOutputCapabilities} from '../src/agents/output-requirements.ts';
import {parseSavedEdit,validatePlan} from '../src/agents/plans.ts';
const catalog=[{agent_id:'worker',default_model:'local',models:[{model_id:'local',label:'Local',revision:'1'}]}];
const legacy={workflow_id:'handoffs',root_agent:'worker',max_handoffs:3,agents:[{agent_id:'worker',model_id:'local',can_handoff_to:[]}]};
const schema={$defs:{name:{type:'string'}},properties:{name:{$ref:'#/$defs/name'}},required:['name']};
test('handoff requirements preserve authored schema and legacy omitted shape',()=>{
 assert.deepEqual(validatePlan(legacy,catalog),legacy);
 const plan=validatePlan({...legacy,answer_requirements:parseOutputRequirements({format:'json_object',output_schema:schema})},catalog);
 assert.deepEqual(plan.answer_requirements.output_schema,schema);
 const saved={space:'alpha',revision:1,plan,configuration_current:true,updated_at:'2026-09-13T00:00:00Z',bindings:{worker:'a'.repeat(64)}};
 assert.deepEqual(parseSavedEdit(saved,'alpha',plan,0).plan,plan);
 const changed=structuredClone(saved);changed.plan.answer_requirements.output_schema.properties.name={type:'number'};
 assert.throws(()=>parseSavedEdit(changed,'alpha',plan,0));
 delete changed.plan.answer_requirements;assert.throws(()=>parseSavedEdit(changed,'alpha',plan,0));
});
test('task support never implies handoff final contract support',()=>{
 const basic=validatePlan({...legacy,answer_requirements:parseOutputRequirements({max_lines:1})},catalog);
 assert.doesNotThrow(()=>requireOutputCapabilities(validatePlan(legacy,catalog),false,false));
 assert.throws(()=>requireOutputCapabilities(basic,true,true));
 assert.doesNotThrow(()=>requireOutputCapabilities(basic,false,false,true));
 const typed=validatePlan({...legacy,answer_requirements:parseOutputRequirements({format:'json_object',output_schema:schema})},catalog);
 assert.throws(()=>requireOutputCapabilities(typed,true,true,false));
 assert.throws(()=>requireOutputCapabilities(typed,false,false,true));
 assert.doesNotThrow(()=>requireOutputCapabilities(typed,false,true,true));
});
test('malformed contracts are rejected in loaded handoff plans',()=>{
 for(const answer_requirements of [[],{max_bytes:true},{format:'json_object',output_schema:[]},{PRIVATE:'PRIVATE'}]){
  assert.throws(()=>validatePlan({...legacy,answer_requirements},catalog));
 }
});
