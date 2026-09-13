import {identifier,isHandoffPlan,isInputTask,record} from './plans.ts';
import {matchRun,parseRunStatus,runAddress,type RunRequest,type RunStatus} from './runs.ts';
import {literalArguments} from './approval-json.ts';
export type Decision='approve'|'deny';
export interface ApprovalCall {step_id:string;selection_id:string;agent_id:string;model_id:string;binding:string;tool_name:string;tool_revision:string;tool_digest:string;arguments_json:string;operation_digest:string}
export interface ToolApproval {space:string;run_id:string;request_id:string;call:Readonly<ApprovalCall>;revision:number;created_at:string;decision:Decision|null;decided_by:string|null;decided_at:string|null;decision_digest:string|null;activation_id:string|null;activated_at:string|null;consumed_at:string|null}
export interface ApprovalContinuation {continuation_id:string;decisions:Record<string,2>}
function fail():never{throw Error('The tool approval response could not be verified.');}
function keys(row:Record<string,unknown>,expected:string):void{const names=expected.split(' ');if(Object.keys(row).length!==names.length||names.some(name=>!Object.hasOwn(row,name)))fail();}
function text(value:unknown,maximum:number):string{if(typeof value!=='string'||!value.trim()||new TextEncoder().encode(value).length>maximum)fail();return value;}
function digest(value:unknown):string{const result=text(value,64);if(!/^[a-f0-9]{64}$/.test(result))fail();return result;}
function stamp(value:unknown):string{const result=text(value,64);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result)||!Number.isFinite(Date.parse(result)))fail();return result;}
const callKeys='step_id selection_id agent_id model_id binding tool_name tool_revision tool_digest arguments_json operation_digest';
const recordKeys='space run_id request_id call revision created_at decision decided_by decided_at decision_digest activation_id activated_at consumed_at';
export function parseApproval(value:unknown,request:RunRequest):Readonly<ToolApproval>{
 const row=record(value);keys(row,recordKeys);const raw=record(row.call);keys(raw,callKeys);
 if(row.space!==request.space||row.run_id!==request.run_id)fail();
 const tool_name=text(raw.tool_name,64),tool_revision=text(raw.tool_revision,128);
 if(!/^[A-Za-z0-9_-]+$/.test(tool_name)||['search_memory','trace_memory','read_memory','compute_memory','answer','unknown_tool','custom_tool'].includes(tool_name)||!/^[A-Za-z0-9._:-]+$/.test(tool_revision))fail();
 const call:Readonly<ApprovalCall>=Object.freeze({step_id:identifier(raw.step_id),selection_id:identifier(raw.selection_id),agent_id:identifier(raw.agent_id),model_id:identifier(raw.model_id),binding:digest(raw.binding),tool_name,tool_revision,tool_digest:digest(raw.tool_digest),arguments_json:literalArguments(raw.arguments_json),operation_digest:digest(raw.operation_digest)});
 if(request.bindings[call.selection_id]!==call.binding)fail();
 if(isHandoffPlan(request.plan)){
  const plan=request.plan,hop=Array.from({length:plan.max_handoffs+1},(_,index)=>`hop-${String(index+1).padStart(2,'0')}`).indexOf(call.step_id);
  const selected=plan.agents.find(agent=>agent.agent_id===call.selection_id);
  if(hop<0||!selected||selected.agent_id!==call.agent_id||selected.model_id!==call.model_id)fail();
  let reachable=new Set([plan.root_agent]);
  for(let index=0;index<hop;index++)reachable=new Set(plan.agents.filter(agent=>reachable.has(agent.agent_id)).flatMap(agent=>agent.can_handoff_to));
  if(!reachable.has(call.agent_id))fail();
 }else{
  const task=request.plan.tasks.find(task=>task.task_id===call.selection_id);
  if(!task||isInputTask(task)||task.task_id!==call.step_id||task.agent_id!==call.agent_id||task.model_id!==call.model_id)fail();
 }
 if(typeof row.revision!=='number'||![1,2,3,4].includes(row.revision))fail();
 const revision=row.revision,decision=row.decision;if(decision!==null&&decision!=='approve'&&decision!=='deny')fail();
 const decided_by=row.decided_by===null?null:identifier(row.decided_by),decided_at=row.decided_at===null?null:stamp(row.decided_at),decision_digest=row.decision_digest===null?null:digest(row.decision_digest);
 const activation_id=row.activation_id===null?null:identifier(row.activation_id),activated_at=row.activated_at===null?null:stamp(row.activated_at),consumed_at=row.consumed_at===null?null:stamp(row.consumed_at);
 if([decision,decided_by,decided_at,decision_digest].some(value=>(value!==null)!==(revision>=2))||[activation_id,activated_at].some(value=>(value!==null)!==(revision>=3))||(consumed_at!==null)!==(revision===4))fail();
 return Object.freeze({space:request.space,run_id:request.run_id,request_id:digest(row.request_id),call,revision,created_at:stamp(row.created_at),decision,decided_by,decided_at,decision_digest,activation_id,activated_at,consumed_at});
}
export function parseApprovalPage(value:unknown,request:RunRequest):Readonly<ToolApproval>[] {
 const row=record(value);if(row.space!==request.space||row.run_id!==request.run_id||!Array.isArray(row.items)||row.items.length>512)fail();
 const items=(row.items as unknown[]).map(value=>parseApproval(value,request)),pending=items.filter(item=>item.revision<4);
 if(new Set(items.map(item=>item.request_id)).size!==items.length||new Set(pending.map(item=>item.call.step_id)).size!==pending.length)fail();return items;
}
export function sameCall(left:Readonly<ToolApproval>,right:Readonly<ToolApproval>):boolean{
 return left.space===right.space&&left.run_id===right.run_id&&left.request_id===right.request_id&&left.created_at===right.created_at&&callKeys.split(' ').every(key=>left.call[key as keyof ApprovalCall]===right.call[key as keyof ApprovalCall]);
}
export function sameDecision(left:Readonly<ToolApproval>,right:Readonly<ToolApproval>):boolean{
 return sameCall(left,right)&&left.decision===right.decision&&left.decided_by===right.decided_by&&left.decided_at===right.decided_at&&left.decision_digest===right.decision_digest;
}
export function matchDecision(saved:Readonly<ToolApproval>,pending:Readonly<ToolApproval>,decision:Decision):void{
 if(!sameCall(saved,pending)||saved.revision<2||saved.decision!==decision||(pending.revision>=2&&!sameDecision(saved,pending)))fail();
}
export function prepareContinuation(items:readonly Readonly<ToolApproval>[],selected:readonly string[],continuationId:string):ApprovalContinuation{
 identifier(continuationId);if(!selected.length||selected.length>32||new Set(selected).size!==selected.length)fail();
 const group=items.filter(item=>item.activation_id===continuationId).map(item=>item.request_id);
 if(group.length&&(group.length!==selected.length||group.some(id=>!selected.includes(id))))fail();
 for(const id of selected){const item=items.find(item=>item.request_id===id);if(!item||item.revision<2||item.decision_digest===null||(item.activation_id!==null&&item.activation_id!==continuationId))fail();}
 return {continuation_id:continuationId,decisions:Object.fromEntries(selected.map(id=>[id,2 as const]))};
}
export function matchContinuation(value:unknown,request:RunRequest,expected:ApprovalContinuation,prior:readonly Readonly<ToolApproval>[]):RunStatus{
 const row=record(value),activation=record(row.activation);keys(activation,'space run_id activation_id created_at decisions decision_digests');
 if(activation.space!==request.space||activation.run_id!==request.run_id||activation.activation_id!==expected.continuation_id)fail();stamp(activation.created_at);
 const revisions=record(activation.decisions),hashes=record(activation.decision_digests),ids=Object.keys(expected.decisions);
 if(Object.keys(revisions).length!==ids.length||Object.keys(hashes).length!==ids.length)fail();
 for(const id of ids){const item=prior.find(item=>item.request_id===id);if(expected.decisions[id]!==2||revisions[id]!==2||!item||item.decision_digest===null||hashes[id]!==item.decision_digest)fail();}
 const status=parseRunStatus(row.status,request.space,request.run_id);matchRun(status,request);return status;
}
export function approvalAddress(runId:string,requestId?:string):string{return runAddress(runId)+'/approvals'+(requestId===undefined?'':'/'+digest(requestId)+'/decision');}
