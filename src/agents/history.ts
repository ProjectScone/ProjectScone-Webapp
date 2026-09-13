// The execution history of a run, read the way the standalone SDK reads
// it: every field checked, positions contiguous, the cursor naming its
// page, and the model binding matching the saved plan. Metadata only --
// no prompt, tool argument, answer or reasoning is in these events, and
// an entry carrying any other field is refused rather than shown.
import {identifier,isHandoffPlan,isInputTask,record} from './plans.ts';
import {runAddress,type RunRequest} from './runs.ts';

const MAX_POSITION=Number.MAX_SAFE_INTEGER;
const TERMINALS=['turn_completed','turn_paused','turn_failed','turn_cancelled'] as const;
const KINDS=['turn_started',...TERMINALS,'operation_started','operation_completed','operation_failed','operation_reused','tool_proposed','tool_result'] as const;
const ERRORS=['unknown_tool','invalid_arguments','timeout','store_error','retrieval_failed','output_bytes','evidence_unavailable','tool_budget','tool_output_budget','search_for_seed_first','search_for_chunk_first','unsupported_chunk_window','invalid_computation','ambiguous_quote','numeric_literal_required','direct_return','approval_denied'] as const;
const PROGRESS_FIELDS=['sequence','invocation_id','agent_id','model_id','binding','kind','occurred_at','elapsed_s','operation_id','operation_kind','duration_s','tool_index','tool_name','status','error','output_bytes','origin','reused','journal_reused','presentation_reused'];
const GAP_FIELDS=['invocation_id','first_sequence','last_sequence'];
const COLLECTION_FIELDS=['kind','collection_id','occurred_at','invocation_id','last_sequence','observed_events','lost_events','terminal_kind','error'];
const PAGE_FIELDS=['space','run_id','available','items','next_after','retained_from','omitted'];

export interface ProgressEvent {type:'progress';sequence:number;invocation_id:string;agent_id:string;model_id:string;binding:string;kind:string;occurred_at:string;elapsed_s:number;operation_id:number|null;operation_kind:string|null;duration_s:number|null;tool_index:number|null;tool_name:string|null;status:string|null;error:string|null;output_bytes:number|null;origin:string|null;reused:boolean|null;journal_reused:boolean|null;presentation_reused:boolean|null}
export interface ProgressGap {type:'gap';invocation_id:string;first_sequence:number;last_sequence:number}
export interface CollectionEvent {type:'collection';kind:string;collection_id:string;occurred_at:string;invocation_id:string|null;last_sequence:number;observed_events:number;lost_events:number;terminal_kind:string|null;error:string|null}
export type HistoryEvent=ProgressEvent|ProgressGap|CollectionEvent;
export interface HistoryEntry {position:number;step_id:string;selection_id:string;event:HistoryEvent;collection_id:string|null;activation_id:string|null}
export interface HistoryPage {space:string;run_id:string;available:boolean;items:HistoryEntry[];next_after:string|null;retained_from:number|null;omitted:[number,number]|null}

function invalid(what:string):never{throw Error('The run history could not be verified: '+what+'.');}
function text(value:unknown,max:number,what:string):string{if(typeof value!=='string'||!value.trim()||value.length>max)invalid(what);return value;}
function integer(value:unknown,min:number,max:number,what:string):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)invalid(what);return value;}
function boolean(value:unknown,what:string):boolean{if(typeof value!=='boolean')invalid(what);return value;}
function timestamp(value:unknown,what:string):string{const result=text(value,64,what);if(!Number.isFinite(Date.parse(result)))invalid(what);return result;}
function hex(value:unknown,length:number,what:string):string{const result=text(value,length,what);if(!new RegExp('^[0-9a-f]{'+length+'}$').test(result))invalid(what);return result;}
function choice<T extends string>(value:unknown,choices:readonly T[],what:string):T{if(typeof value!=='string'||!(choices as readonly string[]).includes(value))invalid(what);return value as T;}
function duration(value:unknown):number{if(typeof value!=='number'||!Number.isFinite(value)||value<0)invalid('event timing');return value;}
function items(value:unknown,max:number,what:string):unknown[]{if(!Array.isArray(value)||value.length>max)invalid(what);return value as unknown[];}
function exact(row:Record<string,unknown>,fields:string[],what:string):void{const keys=Object.keys(row);if(keys.length!==fields.length||fields.some(field=>!Object.hasOwn(row,field)))invalid(what);}
function optional<T>(value:unknown,read:(value:unknown)=>T):T|null{return value===null?null:read(value);}

export function historyCursor(value:unknown):string{
 const result=text(value,114,'history cursor');
 if(!/^[0-9a-f]{32}\.[0-9a-f]{16}\.[0-9a-f]{64}$/.test(result))invalid('history cursor');
 integer(cursorPosition(result),0,MAX_POSITION,'history cursor');
 return result;
}
export function cursorPosition(cursor:string):number{return Number.parseInt(cursor.split('.')[1],16);}
export function historyAddress(id:string):string{return runAddress(id)+'/history';}

function progressEvent(row:Record<string,unknown>):ProgressEvent{
 exact(row,PROGRESS_FIELDS,'progress fields');
 const result:ProgressEvent={type:'progress',sequence:integer(row.sequence,1,MAX_POSITION,'event sequence'),invocation_id:hex(row.invocation_id,32,'invocation'),agent_id:identifier(row.agent_id),model_id:identifier(row.model_id),binding:hex(row.binding,64,'event binding'),kind:choice(row.kind,KINDS,'event kind'),occurred_at:timestamp(row.occurred_at,'event time'),elapsed_s:duration(row.elapsed_s),
  operation_id:optional(row.operation_id,value=>integer(value,1,MAX_POSITION,'operation id')),operation_kind:optional(row.operation_kind,value=>choice(value,['model','memory','custom'],'operation kind')),duration_s:optional(row.duration_s,duration),
  tool_index:optional(row.tool_index,value=>integer(value,1,MAX_POSITION,'tool index')),tool_name:optional(row.tool_name,value=>{const name=text(value,128,'event tool');if(!/^[A-Za-z0-9_-]{1,128}$/.test(name))invalid('event tool');return name;}),
  status:optional(row.status,value=>choice(value,['prepared','empty','unavailable'],'tool status')),error:optional(row.error,value=>choice(value,ERRORS,'tool error')),output_bytes:optional(row.output_bytes,value=>integer(value,0,MAX_POSITION,'tool output')),origin:optional(row.origin,value=>choice(value,['host','model'],'tool origin')),
  reused:optional(row.reused,value=>boolean(value,'tool reuse')),journal_reused:optional(row.journal_reused,value=>boolean(value,'tool reuse')),presentation_reused:optional(row.presentation_reused,value=>boolean(value,'tool reuse'))};
 const operations=[result.operation_id,result.operation_kind,result.duration_s],tool=[result.tool_index,result.tool_name,result.origin],outcome=[result.status,result.error,result.output_bytes,result.reused,result.journal_reused,result.presentation_reused];
 const some=(values:unknown[])=>values.some(value=>value!==null),every=(values:unknown[])=>values.every(value=>value!==null);
 if(result.kind.startsWith('turn_')){if(some([...operations,...tool,...outcome]))invalid('turn metadata');}
 else if(result.kind.startsWith('operation_')){
  const timed=result.kind==='operation_completed'||result.kind==='operation_failed';
  if(result.operation_id===null||result.operation_kind===null||result.origin!==null||timed!==(result.duration_s!==null)||some(outcome))invalid('operation metadata');
  if(result.operation_kind==='model'){if(result.tool_index!==null||result.tool_name!==null)invalid('model operation');}
  else if(result.tool_index===null||result.tool_name===null)invalid('tool operation');
 }else if(some(operations)||!every(tool))invalid('tool metadata');
 else if(result.kind==='tool_proposed'){if(some(outcome))invalid('tool proposal');}
 else if(result.status===null||result.output_bytes===null||result.journal_reused===null||result.presentation_reused===null||result.reused!==(result.journal_reused||result.presentation_reused))invalid('tool outcome');
 return result;
}
function gapEvent(row:Record<string,unknown>):ProgressGap{
 exact(row,GAP_FIELDS,'gap fields');
 const first=integer(row.first_sequence,1,MAX_POSITION,'gap sequence');
 return {type:'gap',invocation_id:hex(row.invocation_id,32,'invocation'),first_sequence:first,last_sequence:integer(row.last_sequence,first,MAX_POSITION,'gap sequence')};
}
function collectionEvent(row:Record<string,unknown>):CollectionEvent{
 exact(row,COLLECTION_FIELDS,'collection fields');
 const result:CollectionEvent={type:'collection',kind:choice(row.kind,['collection_started','collection_finished','collection_failed'],'collection kind'),collection_id:hex(row.collection_id,32,'collection id'),occurred_at:timestamp(row.occurred_at,'collection time'),invocation_id:optional(row.invocation_id,value=>hex(value,32,'invocation')),
  last_sequence:integer(row.last_sequence,0,MAX_POSITION,'collection counts'),observed_events:integer(row.observed_events,0,MAX_POSITION,'collection counts'),lost_events:integer(row.lost_events,0,MAX_POSITION,'collection counts'),terminal_kind:optional(row.terminal_kind,value=>choice(value,TERMINALS,'collection outcome')),error:optional(row.error,value=>choice(value,['history_unavailable','collection_interrupted'],'collection error'))};
 if(result.observed_events+result.lost_events!==result.last_sequence)invalid('collection counts');
 if(result.kind==='collection_started'){if(result.last_sequence||result.invocation_id!==null||result.terminal_kind!==null||result.error!==null)invalid('collection start');}
 else if(result.kind==='collection_finished'){if(result.invocation_id===null||result.terminal_kind===null||!result.last_sequence||result.error!==null)invalid('collection completion');}
 else if(result.error===null)invalid('collection failure');
 return result;
}
export function parseHistoryEvent(value:unknown):HistoryEvent{
 const row=record(value);
 if(!Object.hasOwn(row,'kind'))return gapEvent(row);
 if(typeof row.kind==='string'&&row.kind.startsWith('collection_'))return collectionEvent(row);
 return progressEvent(row);
}

function matchEntry(entry:HistoryEntry,request:RunRequest):void{
 const plan=request.plan;let agent_id:string,model_id:string;
 if(isHandoffPlan(plan)){
  const steps=Array.from({length:plan.max_handoffs+1},(_,index)=>'hop-'+String(index+1).padStart(2,'0'));
  if(!steps.includes(entry.step_id))invalid('history hop');
  const policies=new Map(plan.agents.map(agent=>[agent.agent_id,agent]));
  let reachable=new Set([plan.root_agent]);
  for(let hop=0;hop<steps.indexOf(entry.step_id);hop++)reachable=new Set([...reachable].flatMap(name=>policies.get(name)?.can_handoff_to??[]));
  const selected=policies.get(entry.selection_id);
  if(!reachable.has(entry.selection_id)||!selected)invalid('history route');
  agent_id=selected.agent_id;model_id=selected.model_id;
 }else{
  const task=plan.tasks.find(task=>task.task_id===entry.step_id);
  if(!task||isInputTask(task)||entry.selection_id!==entry.step_id)invalid('history task');
  agent_id=task.agent_id;model_id=task.model_id;
 }
 const binding=request.bindings[entry.selection_id];
 if(binding===undefined)invalid('history selection');
 if(entry.event.type==='progress'&&(entry.event.agent_id!==agent_id||entry.event.model_id!==model_id||entry.event.binding!==binding))invalid('history model binding');
}
export function parseHistoryEntry(value:unknown,request:RunRequest):HistoryEntry{
 const row=record(value),required=['position','step_id','selection_id','event'];
 if(required.some(field=>!Object.hasOwn(row,field))||Object.keys(row).some(key=>!required.includes(key)&&key!=='collection_id'&&key!=='activation_id'))invalid('history entry fields');
 const entry:HistoryEntry={position:integer(row.position,1,MAX_POSITION,'history position'),step_id:identifier(row.step_id),selection_id:identifier(row.selection_id),event:parseHistoryEvent(row.event),
  collection_id:row.collection_id===undefined?null:optional(row.collection_id,value=>hex(value,32,'collection id')),activation_id:row.activation_id===undefined?null:optional(row.activation_id,identifier)};
 if(entry.event.type==='collection'&&entry.collection_id!==entry.event.collection_id)invalid('collection identity');
 matchEntry(entry,request);
 return entry;
}

export function parseHistoryPage(value:unknown,request:RunRequest,after:string|null=null,limit=50):HistoryPage{
 integer(limit,1,100,'history limit');
 const previous=after===null?null:historyCursor(after);
 const row=record(value);exact(row,PAGE_FIELDS,'history page fields');
 if(row.space!==request.space||row.run_id!==request.run_id)invalid('history identity');
 const available=boolean(row.available,'history availability');
 const entries=items(row.items,limit,'history items').map(item=>parseHistoryEntry(item,request));
 if(!available){
  if(entries.length||previous!==null||row.next_after!==null||row.retained_from!==null||row.omitted!==null)invalid('unavailable history');
  return {space:request.space,run_id:request.run_id,available:false,items:[],next_after:null,retained_from:null,omitted:null};
 }
 const next_after=historyCursor(row.next_after),floor=integer(row.retained_from,1,MAX_POSITION,'retention floor');
 const wanted=previous===null?1:cursorPosition(previous)+1,start=Math.max(wanted,floor);
 let omitted:[number,number]|null=null;
 if(row.omitted!==null){const gap=items(row.omitted,2,'retention gap');if(gap.length!==2)invalid('retention gap');omitted=[integer(gap[0],1,MAX_POSITION,'retention gap'),integer(gap[1],1,MAX_POSITION,'retention gap')];}
 const expectedGap=start>wanted?[wanted,start-1]:null;
 if(JSON.stringify(omitted)!==JSON.stringify(expectedGap))invalid('retention continuity');
 if(entries.some((entry,index)=>entry.position!==start+index))invalid('history continuity');
 const expected=entries.length?entries[entries.length-1].position:start-1;
 if(cursorPosition(next_after)!==expected||(!entries.length&&previous!==next_after))invalid('history cursor position');
 if(previous!==null&&next_after.split('.')[0]!==previous.split('.')[0])invalid('history generation');
 const observed=new Map<string,[string|null,string|null,string,string]>();
 for(const entry of entries){
  if(entry.collection_id===null)continue;
  const current:[string|null,string|null,string,string]=[entry.event.type==='collection'?entry.event.invocation_id:entry.event.invocation_id,entry.activation_id,entry.step_id,entry.selection_id];
  const earlier=observed.get(entry.collection_id);
  if(earlier&&(earlier[1]!==current[1]||earlier[2]!==current[2]||earlier[3]!==current[3]||(earlier[0]!==null&&current[0]!==null&&earlier[0]!==current[0])))invalid('collection continuity');
  observed.set(entry.collection_id,[current[0]??(earlier?earlier[0]:null),current[1],current[2],current[3]]);
 }
 return {space:request.space,run_id:request.run_id,available:true,items:entries,next_after,retained_from:floor,omitted};
}

// What an entry says, in words. Never the content of anything -- there is
// none in these events -- only what happened, to which step, and when.
export interface EntryDescription {title:string;detail:string}
const seconds=(value:number)=>`${Number(value.toFixed(3))} s`;
function operation(event:ProgressEvent,verb:string):string{return (event.operation_kind==='model'?'Model call ':'Tool call ')+verb+(event.tool_name?' · '+event.tool_name:'');}
export function describeEntry(entry:HistoryEntry):EntryDescription{
 const event=entry.event;
 if(event.type==='gap')return {title:`Unobserved sequences ${event.first_sequence}–${event.last_sequence}`,detail:'Events the collector did not see; the count between them is unknown'};
 if(event.type==='collection'){
  const counts=`${event.observed_events} observed, ${event.lost_events} lost`;
  if(event.kind==='collection_started')return {title:'Observation started',detail:'at '+event.occurred_at};
  if(event.kind==='collection_finished')return {title:'Observation finished',detail:`${event.terminal_kind} · ${counts} · at ${event.occurred_at}`};
  return {title:'Observation failed',detail:`${event.error} · ${counts} · at ${event.occurred_at}`};
 }
 const when=`elapsed ${seconds(event.elapsed_s)} · at ${event.occurred_at}`;
 switch(event.kind){
  case 'turn_started':return {title:'Turn started',detail:when};
  case 'turn_completed':return {title:'Turn completed',detail:when};
  case 'turn_paused':return {title:'Turn paused',detail:when};
  case 'turn_failed':return {title:'Turn failed',detail:when};
  case 'turn_cancelled':return {title:'Turn cancelled',detail:when};
  case 'operation_started':return {title:operation(event,'started'),detail:when};
  case 'operation_completed':return {title:operation(event,'finished'),detail:`took ${seconds(event.duration_s??0)} · ${when}`};
  case 'operation_failed':return {title:operation(event,'failed'),detail:`after ${seconds(event.duration_s??0)} · ${when}`};
  case 'operation_reused':return {title:operation(event,'reused'),detail:when};
  case 'tool_proposed':return {title:`Tool proposed · ${event.tool_name}`,detail:`by the ${event.origin} · ${when}`};
  default:{
   const reuse=event.journal_reused?'journal reused':event.presentation_reused?'presentation reused':'fresh';
   return {title:`Tool result · ${event.tool_name}`,detail:`${event.status}${event.error?' · '+event.error:''} · ${event.output_bytes} bytes · ${reuse} · ${when}`};
  }
 }
}
