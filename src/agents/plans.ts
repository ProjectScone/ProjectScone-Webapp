import {parseOutputRequirements,type OutputRequirements} from './output-requirements.ts';
export interface ModelChoice {model_id:string;label:string;revision:string}
export interface ToolChoice {name:string;description:string;revision:string}
export interface AgentChoice {agent_id:string;default_model:string;models:ModelChoice[];tools?:ToolChoice[]}
export interface AgentTask {task_id:string;agent_id:string;model_id:string;prompt:string;depends_on:string[];answer_requirements?:OutputRequirements}
export interface HumanInputTask {kind:'input';task_id:string;prompt:string;depends_on:string[];max_response_bytes:number}
export type TaskNode=AgentTask|HumanInputTask;
export function replaceTask(tasks:readonly TaskNode[],index:number,replacement:TaskNode):TaskNode[]{
 const previous=tasks[index];
 if(!previous)throw Error('The task being edited is unavailable.');
 const renamed=previous.task_id!==replacement.task_id;
 if(renamed&&tasks.some((task,i)=>i!==index&&task.task_id===replacement.task_id))throw Error('Another task already uses this identifier. Choose a different name.');
 return tasks.map((task,i)=>{
  const current=i===index?replacement:task;
  if(!renamed||!current.depends_on.includes(previous.task_id))return current;
  return {...current,depends_on:current.depends_on.map(id=>id===previous.task_id?replacement.task_id:id)};
 });
}
export interface InteractivePlan {kind:'interactive';workflow_id:string;tasks:TaskNode[]}
export function isInputTask(task:TaskNode):task is HumanInputTask{return 'kind' in task&&task.kind==='input';}
export function isInteractivePlan(plan:WorkflowPlan):plan is InteractivePlan{return 'kind' in plan&&plan.kind==='interactive';}
export interface AgentPlan {workflow_id:string;tasks:AgentTask[]}
export interface HandoffAgent {agent_id:string;model_id:string;can_handoff_to:string[]}
export interface HandoffPlan {workflow_id:string;root_agent:string;max_handoffs:number;agents:HandoffAgent[];answer_requirements?:OutputRequirements}
export type WorkflowPlan=AgentPlan|HandoffPlan|InteractivePlan;
export interface SavedPlan {space:string;revision:number;plan:WorkflowPlan;configuration_current:boolean;updated_at:string;bindings:Record<string,string>}
export function isHandoffPlan(plan:WorkflowPlan):plan is HandoffPlan{return 'agents' in plan;}
export function bindingIds(plan:WorkflowPlan):string[]{return isHandoffPlan(plan)?plan.agents.map(agent=>agent.agent_id):plan.tasks.filter(task=>!isInputTask(task)).map(task=>task.task_id);}
export function record(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid agent configuration response.');
 return value as Record<string,unknown>;
}
function text(value:unknown,max:number):string{
 if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('Invalid agent configuration text.');
 return value;
}
export function identifier(value:unknown):string{
 const result=text(value,128);
 if(/[^A-Za-z0-9._:-]/.test(result)||result==='.'||result==='..')throw Error('Use letters, numbers, dots, colons, underscores or hyphens for identifiers.');
 return result;
}
function list(value:unknown,max:number):unknown[]{
 if(!Array.isArray(value)||value.length>max)throw Error('Invalid agent configuration list.');
 return value as unknown[];
}
function unique(values:string[]):void{if(new Set(values).size!==values.length)throw Error('Duplicate agent configuration identifiers.');}
const reservedTools=new Set(['search_memory','trace_memory','read_memory','compute_memory','answer','unknown_tool','custom_tool']);
function toolName(value:unknown):string{
 const name=text(value,64);
 if(!/^[A-Za-z0-9_-]+$/.test(name)||reservedTools.has(name))throw Error('Invalid application tool name.');
 return name;
}
function toolTable(value:unknown):Map<string,ToolChoice>{
 const entries=list(value,32).map(value=>{
  const row=record(value);
  if(Object.keys(row).some(key=>!['name','description','revision'].includes(key)))throw Error('Invalid application tool metadata.');
  const name=toolName(row.name),description=text(row.description,4000),revision=text(row.revision,128);
  if(/[\uD800-\uDFFF]/u.test(description)||new TextEncoder().encode(description).length>4000||!/^[A-Za-z0-9._:-]+$/.test(revision))throw Error('Invalid application tool metadata.');
  return {name,description,revision};
 });
 unique(entries.map(tool=>tool.name));
 if(new TextEncoder().encode(JSON.stringify(entries)).length>128000)throw Error('Application tool metadata exceeds its byte limit.');
 return new Map(entries.map(tool=>[tool.name,tool]));
}
function selectedTools(row:Record<string,unknown>,table:Map<string,ToolChoice>|undefined):ToolChoice[]|undefined{
 if(!table){if('tools' in row)throw Error('Application tool descriptions are missing.');return undefined;}
 const names=list(row.tools,32).map(toolName);unique(names);
 return names.map(name=>{const tool=table.get(name);if(!tool)throw Error('Selected application tool is unavailable.');return {...tool};});
}
export function parseCatalog(value:unknown):AgentChoice[]{
 const packet=record(value),table='tools' in packet?toolTable(packet.tools):undefined;
 const agents=list(packet.agents,32).map(value=>{
  const row=record(value),models=list(row.models,64).map(value=>{const model=record(value);return {model_id:identifier(model.model_id),label:text(model.label,256),revision:identifier(model.revision)};});
  unique(models.map(model=>model.model_id));
  const default_model=identifier(row.default_model);
  if(!models.some(model=>model.model_id===default_model))throw Error('Agent default model is unavailable.');
  const tools=selectedTools(row,table);
  return {agent_id:identifier(row.agent_id),default_model,models,...(tools===undefined?{}:{tools})};
 });
 unique(agents.map(agent=>agent.agent_id));return agents;
}
function parsePlan(value:unknown):WorkflowPlan{
 const row=record(value);
 if('agents' in row){
  if(Object.keys(row).some(key=>!['workflow_id','root_agent','max_handoffs','agents','answer_requirements'].includes(key)))throw Error('Invalid handoff plan fields.');
  const agents=list(row.agents,32).map(value=>{
   const agent=record(value),can_handoff_to=list(agent.can_handoff_to,32).map(identifier);unique(can_handoff_to);
   if(Object.keys(agent).some(key=>!['agent_id','model_id','can_handoff_to'].includes(key)))throw Error('Invalid handoff agent fields.');
   return {agent_id:identifier(agent.agent_id),model_id:identifier(agent.model_id),can_handoff_to};
  });
  unique(agents.map(agent=>agent.agent_id));const known=new Set(agents.map(agent=>agent.agent_id)),root_agent=identifier(row.root_agent);
  if(!agents.length||!known.has(root_agent)||agents.some(agent=>agent.can_handoff_to.some(id=>!known.has(id))))throw Error('Choose a known root agent and permitted handoff targets.');
  if(typeof row.max_handoffs!=='number'||!Number.isInteger(row.max_handoffs)||row.max_handoffs<0||row.max_handoffs>31)throw Error('Allow between 0 and 31 handoffs.');
  return {workflow_id:identifier(row.workflow_id),root_agent,max_handoffs:row.max_handoffs,agents,...(row.answer_requirements==null?{}:{answer_requirements:parseOutputRequirements(row.answer_requirements)})};
 }
 const interactive=row.kind==='interactive';
 if(('kind' in row&&!interactive)||Object.keys(row).some(key=>!['workflow_id','tasks',...(interactive?['kind']:[])].includes(key)))throw Error('Invalid task plan fields.');
 const tasks:TaskNode[]=list(row.tasks,32).map(value=>{
  const task=record(value),prompt=text(task.prompt,2000),depends_on=list(task.depends_on,31).map(identifier);
  if(new TextEncoder().encode(prompt).length>2000)throw Error('Each task instruction must fit within 2,000 UTF-8 bytes.');
  unique(depends_on);
  if(task.kind==='input'){
   if(!interactive||Object.keys(task).some(key=>!['kind','task_id','prompt','depends_on','max_response_bytes'].includes(key)))throw Error('Invalid human input task.');
   if(typeof task.max_response_bytes!=='number'||!Number.isInteger(task.max_response_bytes)||task.max_response_bytes<1||task.max_response_bytes>4000)throw Error('Response limit must be between 1 and 4,000 UTF-8 bytes.');
   return {kind:'input',task_id:identifier(task.task_id),prompt,depends_on,max_response_bytes:task.max_response_bytes};
  }
  if(Object.keys(task).some(key=>!['task_id','agent_id','model_id','prompt','depends_on','answer_requirements'].includes(key)))throw Error('Invalid model task fields.');
  return {task_id:identifier(task.task_id),agent_id:identifier(task.agent_id),model_id:identifier(task.model_id),prompt,depends_on,...(task.answer_requirements==null?{}:{answer_requirements:parseOutputRequirements(task.answer_requirements)})};
 });
 if(!tasks.length)throw Error('Add at least one task.');
 unique(tasks.map(task=>task.task_id));
 const known=new Set(tasks.map(task=>task.task_id));
 if(tasks.some(task=>task.depends_on.some(id=>!known.has(id))))throw Error('A task depends on an unknown task.');
 const done=new Set<string>();
 while(done.size<tasks.length){
  const ready=tasks.filter(task=>!done.has(task.task_id)&&task.depends_on.every(id=>done.has(id)));
  if(!ready.length)throw Error('Task dependencies must not form a cycle.');
  ready.forEach(task=>done.add(task.task_id));
 }
 if(interactive){if(!tasks.some(isInputTask))throw Error('Interactive workflows require a human input task.');return {kind:'interactive',workflow_id:identifier(row.workflow_id),tasks};}
 return {workflow_id:identifier(row.workflow_id),tasks:tasks.filter((task):task is AgentTask=>!isInputTask(task))};
}
export function validatePlan(value:unknown,catalog:AgentChoice[]):WorkflowPlan{
 const plan=parsePlan(value);
 const selections=isHandoffPlan(plan)?plan.agents:plan.tasks.flatMap(task=>isInputTask(task)?[]:[task]);
 if(selections.some(task=>!catalog.find(agent=>agent.agent_id===task.agent_id)?.models.some(model=>model.model_id===task.model_id)))throw Error('Choose an available agent and allowed model for every step.');
 return plan;
}
export function parseSavedPlan(value:unknown,space:string):SavedPlan{
 const row=record(value),plan=parsePlan(row.plan),bindings=record(row.bindings);
 if(row.space!==space||!Number.isSafeInteger(row.revision)||(row.revision as number)<1||typeof row.configuration_current!=='boolean')throw Error('Saved plan does not match the connected space or revision.');
 const ids=bindingIds(plan);
 if(Object.keys(bindings).length!==ids.length||ids.some(id=>typeof bindings[id]!=='string'||!/^[a-f0-9]{64}$/.test(bindings[id] as string)))throw Error('Invalid saved model binding.');
 const updated_at=text(row.updated_at,64);
 if(!Number.isFinite(Date.parse(updated_at)))throw Error('Invalid plan update time.');
 return {space,revision:row.revision as number,plan,configuration_current:row.configuration_current,updated_at,bindings:Object.fromEntries(ids.map(id=>[id,bindings[id] as string]))};
}
export function parsePlanPage(value:unknown,space:string):{items:SavedPlan[];next_after:string|null}{
 const row=record(value),items=list(row.items,100).map(item=>parseSavedPlan(item,space));
 unique(items.map(item=>item.plan.workflow_id));
 if(row.next_after!==null&&(typeof row.next_after!=='string'||!/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(row.next_after)))throw Error('Invalid plan page cursor.');
 return {items,next_after:row.next_after as string|null};
}
export function planAddress(id:string):string{return '/v1/agent-plans/'+encodeURIComponent(identifier(id));}
export function parseSavedEdit(value:unknown,space:string,expected:WorkflowPlan,revision:number):SavedPlan{
 const saved=parseSavedPlan(value,space);
 if(saved.revision!==revision+1||JSON.stringify(saved.plan)!==JSON.stringify(expected))throw Error('Saved response does not match the selected tasks and models. Reload the saved workflow to check its state.');
 return saved;
}
