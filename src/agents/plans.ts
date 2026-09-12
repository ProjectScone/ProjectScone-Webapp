export interface ModelChoice {model_id:string;label:string;revision:string}
export interface AgentChoice {agent_id:string;default_model:string;models:ModelChoice[]}
export interface AgentTask {task_id:string;agent_id:string;model_id:string;prompt:string;depends_on:string[]}
export interface AgentPlan {workflow_id:string;tasks:AgentTask[]}
export interface SavedPlan {space:string;revision:number;plan:AgentPlan;configuration_current:boolean;updated_at:string;bindings:Record<string,string>}
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
 if(!/^[A-Za-z0-9._:-]+$/.test(result)||result==='.'||result==='..')throw Error('Use letters, numbers, dots, colons, underscores or hyphens for identifiers.');
 return result;
}
function list(value:unknown,max:number):unknown[]{
 if(!Array.isArray(value)||value.length>max)throw Error('Invalid agent configuration list.');
 return value as unknown[];
}
function unique(values:string[]):void{if(new Set(values).size!==values.length)throw Error('Duplicate agent configuration identifiers.');}
export function parseCatalog(value:unknown):AgentChoice[]{
 const agents=list(record(value).agents,32).map(value=>{
  const row=record(value),models=list(row.models,64).map(value=>{const model=record(value);return {model_id:identifier(model.model_id),label:text(model.label,256),revision:identifier(model.revision)};});
  unique(models.map(model=>model.model_id));
  const default_model=identifier(row.default_model);
  if(!models.some(model=>model.model_id===default_model))throw Error('Agent default model is unavailable.');
  return {agent_id:identifier(row.agent_id),default_model,models};
 });
 unique(agents.map(agent=>agent.agent_id));return agents;
}
function parsePlan(value:unknown):AgentPlan{
 const row=record(value),tasks=list(row.tasks,32).map(value=>{
  const task=record(value),prompt=text(task.prompt,2000),depends_on=list(task.depends_on,31).map(identifier);
  if(new TextEncoder().encode(prompt).length>2000)throw Error('Each task instruction must fit within 2,000 UTF-8 bytes.');
  unique(depends_on);
  return {task_id:identifier(task.task_id),agent_id:identifier(task.agent_id),model_id:identifier(task.model_id),prompt,depends_on};
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
 return {workflow_id:identifier(row.workflow_id),tasks};
}
export function validatePlan(value:unknown,catalog:AgentChoice[]):AgentPlan{
 const plan=parsePlan(value);
 if(plan.tasks.some(task=>!catalog.find(agent=>agent.agent_id===task.agent_id)?.models.some(model=>model.model_id===task.model_id)))throw Error('Choose an available agent and allowed model for every task.');
 return plan;
}
export function parseSavedPlan(value:unknown,space:string):SavedPlan{
 const row=record(value),plan=parsePlan(row.plan),bindings=record(row.bindings);
 if(row.space!==space||!Number.isSafeInteger(row.revision)||(row.revision as number)<1||typeof row.configuration_current!=='boolean')throw Error('Saved plan does not match the connected space or revision.');
 if(Object.keys(bindings).length!==plan.tasks.length||plan.tasks.some(task=>typeof bindings[task.task_id]!=='string'||!/^[a-f0-9]{64}$/.test(bindings[task.task_id] as string)))throw Error('Invalid saved model binding.');
 const updated_at=text(row.updated_at,64);
 if(!Number.isFinite(Date.parse(updated_at)))throw Error('Invalid plan update time.');
 return {space,revision:row.revision as number,plan,configuration_current:row.configuration_current,updated_at,bindings:Object.fromEntries(plan.tasks.map(task=>[task.task_id,bindings[task.task_id] as string]))};
}
export function parsePlanPage(value:unknown,space:string):{items:SavedPlan[];next_after:string|null}{
 const row=record(value),items=list(row.items,100).map(item=>parseSavedPlan(item,space));
 unique(items.map(item=>item.plan.workflow_id));
 if(row.next_after!==null&&(typeof row.next_after!=='string'||!/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(row.next_after)))throw Error('Invalid plan page cursor.');
 return {items,next_after:row.next_after as string|null};
}
export function planAddress(id:string):string{return '/v1/agent-plans/'+encodeURIComponent(identifier(id));}
export function parseSavedEdit(value:unknown,space:string,expected:AgentPlan,revision:number):SavedPlan{
 const saved=parseSavedPlan(value,space);
 if(saved.revision!==revision+1||JSON.stringify(saved.plan)!==JSON.stringify(expected))throw Error('Saved response does not match the selected tasks and models. Reload the saved workflow to check its state.');
 return saved;
}
