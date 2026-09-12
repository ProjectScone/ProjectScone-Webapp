import {identifier,isHandoffPlan,isInputTask,record} from './plans.ts';
import {type RunRequest,runAddress} from './runs.ts';
export interface RunInput {space:string;run_id:string;task_id:string;prompt:string;context:string;max_response_bytes:number;revision:number;response:string|null;activation_id:string|null;created_at:string;responded_at:string|null}
function fail():never{throw Error('The human input response could not be verified.');}
function text(value:unknown,max:number):string{if(typeof value!=='string'||!value.trim()||new TextEncoder().encode(value).length>max)fail();return value;}
function date(value:unknown):string{const result=text(value,64);if(!Number.isFinite(Date.parse(result)))fail();return result;}
export function parseInput(value:unknown,request:RunRequest):RunInput{
 const row=record(value),task=isHandoffPlan(request.plan)?undefined:request.plan.tasks.find(task=>task.task_id===row.task_id);
 if(!task||!isInputTask(task)||row.space!==request.space||row.run_id!==request.run_id||row.prompt!==task.prompt||row.max_response_bytes!==task.max_response_bytes)fail();
 if(typeof row.revision!=='number'||![1,2,3].includes(row.revision))fail();
 const response=row.response===null?null:text(row.response,task.max_response_bytes),activation_id=row.activation_id===null?null:identifier(row.activation_id);
 const responded_at=row.responded_at===null?null:date(row.responded_at),context=text(row.context,32000);
 let parsed:unknown;try{parsed=JSON.parse(context);}catch{fail();}
 if(!Array.isArray(parsed)||parsed.length!==task.depends_on.length)fail();
 for(const [index,value] of (parsed as unknown[]).entries()){
  const dependency=record(value);
  if(dependency.task_id!==task.depends_on[index])fail();
  text(dependency.text,64000);
 }
 if((row.revision===1)!==(response===null)||(response===null)!==(responded_at===null)||(row.revision===3)!==(activation_id!==null))fail();
 return {space:request.space,run_id:request.run_id,task_id:task.task_id,prompt:task.prompt,context,max_response_bytes:task.max_response_bytes,revision:row.revision,response,activation_id,created_at:date(row.created_at),responded_at};
}
export function parseInputPage(value:unknown,request:RunRequest):RunInput[]{
 const page=record(value);if(page.space!==request.space||page.run_id!==request.run_id||!Array.isArray(page.items)||page.items.length>32)fail();
 const items=(page.items as unknown[]).map(value=>parseInput(value,request));
 if(new Set(items.map(item=>item.task_id)).size!==items.length)fail();return items;
}
export function validateResponse(input:Pick<RunInput,'max_response_bytes'>,response:string):{response:string;expected_revision:1}{
 text(response,input.max_response_bytes);return {response,expected_revision:1};
}
export function inputAddress(runId:string,taskId:string):string{return runAddress(runId)+'/inputs/'+encodeURIComponent(identifier(taskId))+'/response';}
export function matchInputResults(result:import('./runs.ts').RunResult,inputs:RunInput[]):void{
 for(const output of result.tasks){
  if(output.kind!=='human_input')continue;
  const input=inputs.find(input=>input.task_id===output.task_id);
  if(!input||input.revision!==3||input.activation_id!==output.activation_id||input.response!==output.text)fail();
 }
}
export function matchInputActivation(items:RunInput[],expected:{continuation_id:string;responses:Record<string,number>},prior:RunInput[]):void{
 const activated=items.filter(item=>item.activation_id===expected.continuation_id);
 const selected=Object.keys(expected.responses).sort();
 if(!selected.length||JSON.stringify(activated.map(item=>item.task_id).sort())!==JSON.stringify(selected))fail();
 for(const item of activated){
  const original=prior.find(input=>input.task_id===item.task_id);
  if(expected.responses[item.task_id]!==2||item.revision!==3||!original||original.response===null||item.response!==original.response)fail();
 }
}
