import {usageFields,type ToolTokenUsage} from './usage.ts';
import {bindingIds,identifier,isHandoffPlan,isInputTask,parseSavedPlan,record,type WorkflowPlan,type HandoffPlan} from './plans.ts';
export interface RunStatus {space:string;run_id:string;created_at:string;workflow_id:string;plan_revision:number;status:string;active_local:boolean;completed_steps:string[];inflight:string|null;outcome_unknown:boolean;error_class:string|null;max_parallel:number;inflight_steps:string[];waiting_steps:string[]}
export interface RunRequest {space:string;run_id:string;question:string;created_at:string;plan:WorkflowPlan;revision:number;bindings:Record<string,string>;max_parallel:number}
export interface TaskOutput {kind?:'model';task_id:string;agent_id:string;model_id:string;text:string;source_status:'retained'|'none';evidence_ids:string[];model_calls:number;tool_calls:number;handoff_to?:string|null;usage?:ToolTokenUsage|null}
export interface HumanOutput {kind:'human_input';task_id:string;text:string;activation_id:string}
export interface RunResult {reusedTasks?:string[];tasks:(TaskOutput|HumanOutput)[];outcome?:'completed'|'handoff_limit';finalTask?:string|null}
function fail():never{throw Error('The run response could not be verified.');}
function text(value:unknown,max:number):string{if(typeof value!=='string'||!value.trim()||value.length>max)fail();return value;}
function integer(value:unknown,min:number,max=Number.MAX_SAFE_INTEGER):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)fail();return value;}
function date(value:unknown):string{const result=text(value,64);if(!Number.isFinite(Date.parse(result)))fail();return result;}
function bool(value:unknown):boolean{if(typeof value!=='boolean')fail();return value;}
function list(value:unknown,max:number):unknown[]{if(!Array.isArray(value)||value.length>max)fail();return value as unknown[];}
function names(value:unknown,max=32):string[]{const result=list(value,max).map(identifier);if(new Set(result).size!==result.length)fail();return result;}
export function runAddress(id:string):string{return '/v1/agent-runs/'+encodeURIComponent(identifier(id));}
export function validateStart(run_id:string,workflow_id:string,plan_revision:number,question:string,max_parallel=1){
 identifier(run_id);identifier(workflow_id);integer(plan_revision,1);text(question,4000);
 if(new TextEncoder().encode(question).length>4000)throw Error('The question must fit within 4,000 UTF-8 bytes.');
 integer(max_parallel,1,8);
 return {run_id,workflow_id,plan_revision,question,...(max_parallel>1?{max_parallel}:{})};
}
export function parseRunStatus(value:unknown,space:string,runId?:string):RunStatus{
 const row=record(value),run_id=identifier(row.run_id);
 if(row.space!==space||(runId!==undefined&&run_id!==runId))fail();
 const status=text(row.status,64),inflight=row.inflight===null?null:identifier(row.inflight),inflight_steps=row.inflight_steps===undefined?(inflight?[inflight]:[]):names(row.inflight_steps);
 const max_parallel=integer(row.max_parallel===undefined?1:row.max_parallel,1,8);
 if((inflight_steps[0]??null)!==inflight||inflight_steps.length>max_parallel)fail();
 if(!['created','deadline','outcome_unknown','retry_not_allowed','registered','running','completed','failed','cancelled','sources_invalid','verification_unavailable','unavailable','awaiting_input'].includes(status))fail();
 return {space,run_id,created_at:date(row.created_at),workflow_id:identifier(row.workflow_id),plan_revision:integer(row.plan_revision,1),status,
  active_local:bool(row.active_local),completed_steps:names(row.completed_steps),inflight,inflight_steps,waiting_steps:row.waiting_steps===undefined?[]:names(row.waiting_steps),max_parallel,outcome_unknown:bool(row.outcome_unknown),error_class:row.error_class===null?null:text(row.error_class,128)};
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
 const max_parallel=integer(row.max_parallel===undefined?1:row.max_parallel,1,isHandoffPlan(saved.plan)?1:8);
 return {space,run_id:identifier(runId),created_at:date(row.created_at),question,plan:saved.plan,revision:saved.revision,max_parallel,
  bindings:Object.fromEntries(bindingIds(saved.plan).map(id=>[id,text(bindings[id],64)]))};
}
function hopIds(plan:HandoffPlan):string[]{return Array.from({length:plan.max_handoffs+1},(_,index)=>`hop-${String(index+1).padStart(2,'0')}`);}
export function matchRun(status:RunStatus,request:RunRequest):void{
 if(status.run_id!==request.run_id||status.space!==request.space||status.workflow_id!==request.plan.workflow_id||status.plan_revision!==request.revision||status.max_parallel!==request.max_parallel||Date.parse(status.created_at)!==Date.parse(request.created_at))fail();
 const ids=isHandoffPlan(request.plan)?hopIds(request.plan):request.plan.tasks.map(task=>task.task_id),known=new Set(ids);
 if([...status.completed_steps,...status.inflight_steps,...status.waiting_steps].some(id=>!known.has(id))||(status.inflight!==null&&!known.has(status.inflight)))fail();
 if(!isHandoffPlan(request.plan)){const tasks=request.plan.tasks;if(status.inflight_steps.some(id=>tasks.some(task=>task.task_id===id&&isInputTask(task))))fail();}
 if(status.waiting_steps.some(id=>isHandoffPlan(request.plan)||!request.plan.tasks.some(task=>task.task_id===id&&isInputTask(task)))||status.waiting_steps.some(id=>status.completed_steps.includes(id)||status.inflight_steps.includes(id)))fail();
 if(isHandoffPlan(request.plan)&&JSON.stringify(status.completed_steps)!==JSON.stringify(ids.slice(0,status.completed_steps.length)))fail();
 if(isHandoffPlan(request.plan)&&status.inflight!==null&&status.inflight!==ids[status.completed_steps.length])fail();
}
function parseOutput(value:unknown,expected:{task_id:string;agent_id:string;model_id:string;binding:string;depends_on:string[]},includeUsage:boolean):{output:TaskOutput;packets:string[]}{
 const output=record(value);
 if(output.task_id!==expected.task_id||output.agent_id!==expected.agent_id||output.model_id!==expected.model_id||output.binding!==expected.binding||JSON.stringify(names(output.depends_on))!==JSON.stringify(expected.depends_on))fail();
 const evidence_ids=list(output.evidence_ids,2048).map(id=>text(id,4096));
 const packets=list(output.evidence_packets,32).map(packet=>text(packet,1_048_576));
 if(output.source_status!==(evidence_ids.length?'retained':'none'))fail();
 return {output:{task_id:expected.task_id,agent_id:expected.agent_id,model_id:expected.model_id,text:text(output.text,64000),source_status:output.source_status as 'retained'|'none',evidence_ids,model_calls:integer(output.model_calls,1,17),tool_calls:integer(output.tool_calls,0,16),...usageFields(output,integer(output.model_calls,1,17),includeUsage)},packets};
}
function parseHandoffResult(row:Record<string,unknown>,request:RunRequest,plan:HandoffPlan,includeUsage:boolean):RunResult{
 const hops=list(row.hops,plan.max_handoffs+1),ids=hopIds(plan).slice(0,hops.length),tasks:TaskOutput[]=[];
 if(!hops.length||row.space!==request.space||row.run_id!==request.run_id||!['completed','handoff_limit'].includes(String(row.status)))fail();
 if(names(row.reused_hops).some(id=>!ids.includes(id)))fail();
 let current:string|null=plan.root_agent,packetCount=0;
 for(const [index,value] of hops.entries()){
  const hop=record(value),agent=plan.agents.find(agent=>agent.agent_id===current);
  if(!agent)fail();
  const expected={task_id:ids[index],agent_id:agent.agent_id,model_id:agent.model_id,binding:request.bindings[agent.agent_id],depends_on:index?[ids[index-1]]:[]};
  const parsed=parseOutput(hop.output,expected,includeUsage);packetCount+=parsed.packets.length;
  const next=hop.handoff_to===null?null:identifier(hop.handoff_to);
  if(next!==null&&!agent.can_handoff_to.includes(next))fail();
  if(index<hops.length-1&&next===null)fail();
  tasks.push({...parsed.output,handoff_to:next});current=next;
  if(index===hops.length-1){
   if(next===null){
    if(row.status!=='completed')fail();
    const final=parseOutput(row.final,expected,includeUsage);
    if(JSON.stringify(final)!==JSON.stringify(parsed))fail();
   }else if(row.status!=='handoff_limit'||hops.length!==plan.max_handoffs+1||row.final!==null)fail();
  }
 }
 if(packetCount>128)fail();
 return {tasks,reusedTasks:names(row.reused_hops),outcome:current===null?'completed':'handoff_limit',finalTask:current===null?ids[ids.length-1]:null};
}
export function parseRunResult(value:unknown,request:RunRequest,includeUsage=false):RunResult{
 if(isHandoffPlan(request.plan))return parseHandoffResult(record(value),request,request.plan,includeUsage);
 const row=record(value),results=record(row.results),known=new Set(request.plan.tasks.map(task=>task.task_id));
 if(row.space!==request.space||row.run_id!==request.run_id||row.status!=='completed'||Object.keys(results).length!==known.size)fail();
 if(names(row.reused_steps).some(id=>!known.has(id)))fail();
 let packets=0;
 const tasks:(TaskOutput|HumanOutput)[]=request.plan.tasks.map(task=>{
  const output=record(results[task.task_id]);
  if(isInputTask(task)){
   if(Object.keys(output).some(key=>!['kind','task_id','depends_on','text','activation_id','response_digest'].includes(key))||output.kind!=='human_input'||output.task_id!==task.task_id||JSON.stringify(names(output.depends_on))!==JSON.stringify(task.depends_on)||typeof output.response_digest!=='string'||!/^[a-f0-9]{64}$/.test(output.response_digest))fail();
   const reply=text(output.text,task.max_response_bytes);if(new TextEncoder().encode(reply).length>task.max_response_bytes)fail();
   return {kind:'human_input',task_id:task.task_id,text:reply,activation_id:identifier(output.activation_id)};
  }
  if(output.task_id!==task.task_id||output.agent_id!==task.agent_id||output.model_id!==task.model_id||output.binding!==request.bindings[task.task_id]||JSON.stringify(names(output.depends_on))!==JSON.stringify(task.depends_on))fail();
  const evidence_ids=list(output.evidence_ids,2048).map(id=>text(id,4096));
  const evidence_packets=list(output.evidence_packets,32).map(packet=>text(packet,1_048_576));packets+=evidence_packets.length;
  if(output.source_status!==(evidence_ids.length?'retained':'none'))fail();
  return {task_id:task.task_id,agent_id:task.agent_id,model_id:task.model_id,text:text(output.text,64000),source_status:output.source_status as 'retained'|'none',evidence_ids,model_calls:integer(output.model_calls,1,17),tool_calls:integer(output.tool_calls,0,16),...usageFields(output,integer(output.model_calls,1,17),includeUsage)};
 });
 if(packets>128)fail();
 return {tasks,reusedTasks:names(row.reused_steps)};
}

export type RunSubmission=Omit<RunRequest,'created_at'>;
export function matchSubmission(request:RunRequest,expected:RunSubmission):void{
 if(request.space!==expected.space||request.run_id!==expected.run_id||request.question!==expected.question||request.revision!==expected.revision||request.max_parallel!==expected.max_parallel||JSON.stringify(request.plan)!==JSON.stringify(expected.plan)||bindingIds(request.plan).some(id=>request.bindings[id]!==expected.bindings[id]))throw Error('The recorded run does not match the submitted question, workflow and models. Its output has been withheld.');
}

export function parseRunPolicy(value:unknown,space:string):number{
 const row=record(value);if(row.space!==space)fail();integer(row.max_active_runs,1,32);return integer(row.max_parallel_tasks,1,8);
}
