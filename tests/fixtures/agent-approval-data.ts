import {parseRunRequest} from '../../src/agents/runs.ts';
export const time='2026-09-13T10:00:00Z';
export const task={task_id:'send',agent_id:'worker',model_id:'careful',prompt:'Send a note',depends_on:[]};
export const request=parseRunRequest({space:'alpha',run_id:'one',created_at:time,question:'Hello',plan:{space:'alpha',revision:1,updated_at:time,plan:{workflow_id:'job',tasks:[task]},bindings:{send:'a'.repeat(64)}}},'alpha','one');
export const call={step_id:'send',selection_id:'send',agent_id:'worker',model_id:'careful',binding:'a'.repeat(64),tool_name:'send_note',tool_revision:'.',tool_digest:'b'.repeat(64),arguments_json:'{"message":"<script>hello</script>"}',operation_digest:'c'.repeat(64)};
export const pending={space:'alpha',run_id:'one',request_id:'d'.repeat(64),call,revision:1,created_at:time,decision:null,decided_by:null,decided_at:null,decision_digest:null,activation_id:null,activated_at:null,consumed_at:null};
export const decided={...pending,revision:2,decision:'approve',decided_by:'key:owner',decided_at:time,decision_digest:'e'.repeat(64)};
export const status={space:'alpha',run_id:'one',created_at:time,workflow_id:'job',plan_revision:1,status:'paused',active_local:false,completed_steps:[],inflight:null,outcome_unknown:false,error_class:null,paused_steps:['send']};
export const page=(items:unknown[])=>({space:'alpha',run_id:'one',items});
