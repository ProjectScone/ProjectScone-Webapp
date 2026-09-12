import {identifier,parseSavedPlan,record,type AgentPlan} from './plans.ts';
export interface RunStatus {space:string;run_id:string;created_at:string;workflow_id:string;plan_revision:number;status:string;active_local:boolean;completed_steps:string[];inflight:string|null;outcome_unknown:boolean;error_class:string|null}
export interface RunRequest {space:string;run_id:string;question:string;created_at:string;plan:AgentPlan;revision:number;bindings:Record<string,string>}
export interface TaskOutput {task_id:string;agent_id:string;model_id:string;text:string;source_status:'retained'|'none';evidence_ids:string[];model_calls:number;tool_calls:number}
function fail():never{throw Error('The run response could not be verified.');}
function text(value:unknown,max:number):string{if(typeof value!=='string'||!value.trim()||value.length>max)fail();return value;}
function integer(value:unknown,min:number,max=Number.MAX_SAFE_INTEGER):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)fail();return value;}
function date(value:unknown):string{const result=text(value,64);if(!Number.isFinite(Date.parse(result)))fail();return result;}
function bool(value:unknown):boolean{if(typeof value!=='boolean')fail();return value;}
function list(value:unknown,max:number):unknown[]{if(!Array.isArray(value)||value.length>max)fail();return value as unknown[];}
function names(value:unknown,max=32):string[]{const result=list(value,max).map(identifier);if(new Set(result).size!==result.length)fail();return result;}
export function runAddress(id:string):string{return '/v1/agent-runs/'+encodeURIComponent(identifier(id));}
export function validateStart(run_id:string,workflow_id:string,plan_revision:number,question:string){
 identifier(run_id);identifier(workflow_id);integer(plan_revision,1);text(question,4000);
 if(new TextEncoder().encode(question).length>4000)throw Error('The question must fit within 4,000 UTF-8 bytes.');
 return {run_id,workflow_id,plan_revision,question};
}
export function parseRunStatus(value:unknown,space:string,runId?:string):RunStatus{
 const row=record(value),run_id=identifier(row.run_id);
 if(row.space!==space||(runId!==undefined&&run_id!==runId))fail();
 const status=text(row.status,64);
 if(!['created','deadline','outcome_unknown','retry_not_allowed','registered','running','completed','failed','cancelled','sources_invalid','verification_unavailable','unavailable'].includes(status))fail();
 return {space,run_id,created_at:date(row.created_at),workflow_id:identifier(row.workflow_id),plan_revision:integer(row.plan_revision,1),status,
  active_local:bool(row.active_local),completed_steps:names(row.completed_steps),inflight:row.inflight===null?null:identifier(row.inflight),outcome_unknown:bool(row.outcome_unknown),error_class:row.error_class===null?null:text(row.error_class,128)};
}
export function parseRunPage(value:unknown,space:string):{items:RunStatus[];next_after:string|null}{
 const row=record(value),items=list(row.items,100).map(item=>parseRunStatus(item,space));
 if(new Set(items.map(item=>item.run_id)).size!==items.length)fail();
 if(row.next_after!==null&&(typeof row.next_after!=='string'||!/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(row.next_after)))fail();
 return {items,next_after:row.next_after as string|null};
}
export function parseRunRequest(value:unknown,space:string,runId:string):RunRequest{
 const row=record(value),raw=record(row.plan);
 if(row.space!==space||row.run_id!==runId)fail();
 const saved=parseSavedPlan({...raw,configuration_current:false},space),bindings=record(raw.bindings);
 const question=text(row.question,4000);validateStart(runId,saved.plan.workflow_id,saved.revision,question);
 return {space,run_id:identifier(runId),created_at:date(row.created_at),question,plan:saved.plan,revision:saved.revision,
  bindings:Object.fromEntries(saved.plan.tasks.map(task=>[task.task_id,text(bindings[task.task_id],64)]))};
}
export function matchRun(status:RunStatus,request:RunRequest):void{
 if(status.run_id!==request.run_id||status.space!==request.space||status.workflow_id!==request.plan.workflow_id||status.plan_revision!==request.revision||Date.parse(status.created_at)!==Date.parse(request.created_at))fail();
 const known=new Set(request.plan.tasks.map(task=>task.task_id));
 if(status.completed_steps.some(id=>!known.has(id))||(status.inflight!==null&&!known.has(status.inflight)))fail();
}
export function parseRunResult(value:unknown,request:RunRequest):{tasks:TaskOutput[]}{
 const row=record(value),results=record(row.results),known=new Set(request.plan.tasks.map(task=>task.task_id));
 if(row.space!==request.space||row.run_id!==request.run_id||row.status!=='completed'||Object.keys(results).length!==known.size)fail();
 if(names(row.reused_steps).some(id=>!known.has(id)))fail();
 let packets=0;
 const tasks=request.plan.tasks.map(task=>{
  const output=record(results[task.task_id]);
  if(output.task_id!==task.task_id||output.agent_id!==task.agent_id||output.model_id!==task.model_id||output.binding!==request.bindings[task.task_id]||JSON.stringify(names(output.depends_on))!==JSON.stringify(task.depends_on))fail();
  const evidence_ids=list(output.evidence_ids,2048).map(id=>text(id,4096));
  const evidence_packets=list(output.evidence_packets,32).map(packet=>text(packet,1_048_576));packets+=evidence_packets.length;
  if(output.source_status!==(evidence_ids.length?'retained':'none'))fail();
  return {task_id:task.task_id,agent_id:task.agent_id,model_id:task.model_id,text:text(output.text,64000),source_status:output.source_status as 'retained'|'none',evidence_ids,model_calls:integer(output.model_calls,1,17),tool_calls:integer(output.tool_calls,0,16)};
 });
 if(packets>128)fail();
 return {tasks};
}

export type RunSubmission=Omit<RunRequest,'created_at'>;
export function matchSubmission(request:RunRequest,expected:RunSubmission):void{
 if(request.space!==expected.space||request.run_id!==expected.run_id||request.question!==expected.question||request.revision!==expected.revision||JSON.stringify(request.plan)!==JSON.stringify(expected.plan)||request.plan.tasks.some(task=>request.bindings[task.task_id]!==expected.bindings[task.task_id]))throw Error('The recorded run does not match the submitted question, tasks and models. Its output has been withheld.');
}
