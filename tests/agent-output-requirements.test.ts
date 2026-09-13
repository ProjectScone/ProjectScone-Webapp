import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOutputRequirements,parseSchemaDraft,requireOutputCapabilities} from '../src/agents/output-requirements.ts';
import {parseSavedEdit,validatePlan} from '../src/agents/plans.ts';
const catalog=[{agent_id:'worker',default_model:'local',models:[{model_id:'local',label:'Local',revision:'1'}]}];
const schema={$defs:{name:{type:'string'}},properties:{name:{$ref:'#/$defs/name'}},required:['name']};
const task={task_id:'one',agent_id:'worker',model_id:'local',prompt:'Answer',depends_on:[]};
test('authored schemas and omitted contracts retain their exact plan meaning',()=>{
 const requirements=parseOutputRequirements({format:'json_object',output_schema:schema});
 const plan=validatePlan({workflow_id:'w',tasks:[{...task,answer_requirements:requirements}]},catalog);
 assert.deepEqual(plan.tasks[0].answer_requirements.output_schema,schema);
 assert(!('answer_requirements' in validatePlan({workflow_id:'w',tasks:[task]},catalog).tasks[0]));
 const saved={space:'alpha',revision:1,plan,configuration_current:true,updated_at:'2026-09-13T00:00:00Z',bindings:{one:'a'.repeat(64)}};
 assert.deepEqual(parseSavedEdit(saved,'alpha',plan,0).plan,plan);
 const changed=structuredClone(saved);changed.plan.tasks[0].answer_requirements.output_schema.properties.name.type='number';
 assert.throws(()=>parseSavedEdit(changed,'alpha',plan,0));
 assert(Object.isFrozen(requirements.output_schema.properties));
});
test('contract limits refuse malformed values and unrepresentable schema numbers',()=>{
 for(const value of [{max_bytes:true},{max_lines:0},{instructions:'界'.repeat(2667)},{format:'json'},{output_schema:{}},{format:'json_object',output_schema:[]},{unknown:true},{format:'json_object',output_schema:{const:Infinity}},{format:'json_object',output_schema:{const:9007199254740992}}])assert.throws(()=>parseOutputRequirements(value));
 const cycle={};cycle.x=cycle;assert.throws(()=>parseOutputRequirements({format:'json_object',output_schema:cycle}));
 assert.equal(parseOutputRequirements({instructions:'é'.repeat(4000)}).instructions.length,4000);
 assert.throws(()=>parseOutputRequirements({instructions:'\ud800'}));
});
test('schema drafts reject malformed JSON and duplicate keys without rewriting local references',()=>{
 assert.deepEqual(parseSchemaDraft(JSON.stringify(schema)),schema);
 assert.equal(parseSchemaDraft('  '),undefined);
 for(const value of ['{','[]','{"a":1,"a":2}','{"properties":{"x":{},"\\u0078":{}}}','{"const":1e400}'])assert.throws(()=>parseSchemaDraft(value));
 assert.deepEqual(parseSchemaDraft('{"properties":{"x":{},"nested":{"properties":{"x":{}}}}}'),{properties:{x:{},nested:{properties:{x:{}}}}});
});
test('saving contracts requires negotiated capabilities while legacy plans still work',()=>{
 const legacy=validatePlan({workflow_id:'w',tasks:[task]},catalog);
 assert.doesNotThrow(()=>requireOutputCapabilities(legacy,false,false));
 const basic=validatePlan({workflow_id:'w',tasks:[{...task,answer_requirements:parseOutputRequirements({})}]},catalog);
 assert.throws(()=>requireOutputCapabilities(basic,false,false));
 assert.doesNotThrow(()=>requireOutputCapabilities(basic,true,false));
 const typed=validatePlan({workflow_id:'w',tasks:[{...task,answer_requirements:parseOutputRequirements({format:'json_object',output_schema:schema})}]},catalog);
 assert.throws(()=>requireOutputCapabilities(typed,true,false));
 assert.doesNotThrow(()=>requireOutputCapabilities(typed,true,true));
});
test('schema drafts refuse numeric rounding and underflow before submission',()=>{
 for(const value of ['{"const":1e-400}','{"const":1.0000000000000001}','{"const":9007199254740991.1}'])assert.throws(()=>parseSchemaDraft(value));
 for(const value of ['{"const":1.0}','{"const":1.25e2}','{"const":0e99999}','{"const":1e-20}'])assert.doesNotThrow(()=>parseSchemaDraft(value));
});
