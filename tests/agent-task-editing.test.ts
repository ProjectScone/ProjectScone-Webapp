import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceTask,validatePlan,type TaskNode} from '../src/agents/plans.ts';

const catalog=[{agent_id:'research',default_model:'fast',models:[
 {model_id:'fast',label:'Fast',revision:'1'},
 {model_id:'careful',label:'Careful',revision:'1'},
]}];
const task=(id:string,depends_on:string[]=[],model_id='fast'):TaskNode=>({task_id:id,agent_id:'research',model_id,prompt:`Complete ${id}`,depends_on});

test('rename rewrites incoming edges without altering choices or the original draft',()=>{
 const tasks=[task('find',[],'careful'),task('summarize',['find']),task('publish',['find','summarize'])];
 const before=structuredClone(tasks);
 const edited=replaceTask(tasks,0,{...tasks[0],task_id:'research'});
 assert.deepEqual(edited.map(node=>node.depends_on),[[],['research'],['research','summarize']]);
 assert.deepEqual(edited.map(node=>'model_id' in node?node.model_id:null),['careful','fast','fast']);
 assert.deepEqual(tasks,before);
 assert.deepEqual(validatePlan({workflow_id:'report',tasks:edited},catalog),{workflow_id:'report',tasks:edited});
});

test('a name collision cannot retarget dependencies to another task',()=>{
 const tasks=[task('find'),task('summarize'),task('publish',['find','summarize'])];
 const before=structuredClone(tasks);
 assert.throws(()=>replaceTask(tasks,0,{...tasks[0],task_id:'summarize'}),/already uses/);
 assert.deepEqual(tasks,before);
 assert.deepEqual(replaceTask(tasks,0,{...tasks[0],task_id:'research'})[2].depends_on,['research','summarize']);
});

test('human-input renames retain downstream dependencies and input limits',()=>{
 const input:TaskNode={kind:'input',task_id:'approval',prompt:'Choose a scope',depends_on:[],max_response_bytes:128};
 const tasks=[input,task('write',['approval'],'careful')];
 const edited=replaceTask(tasks,0,{...input,task_id:'scope'});
 assert.deepEqual(edited[0],{...input,task_id:'scope'});
 assert.deepEqual(edited[1],{...tasks[1],depends_on:['scope']});
 assert.deepEqual(validatePlan({kind:'interactive',workflow_id:'report',tasks:edited},catalog),{kind:'interactive',workflow_id:'report',tasks:edited});
});

test('ordinary task edits retain the dependency graph',()=>{
 const tasks=[task('find'),task('write',['find'])];
 const edited=replaceTask(tasks,1,{...tasks[1],prompt:'Check the source'});
 assert.deepEqual(edited.map(node=>node.depends_on),[[],['find']]);
 assert.equal(edited[1].prompt,'Check the source');
 assert.equal(tasks[1].prompt,'Complete write');
});
