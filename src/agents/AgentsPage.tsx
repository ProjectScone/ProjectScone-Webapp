import {useEffect,useRef,useState} from 'react';
import {ApiError,type ApiClient} from '../api';
import {parseCapabilities} from '../capabilities';
import {WorkspaceState} from '../components/WorkspaceState';
import {isHandoffPlan,isInputTask,isInteractivePlan,parseCatalog,parsePlanPage,parseSavedEdit,planAddress,record,replaceTask,validatePlan,type AgentChoice,type TaskNode,type AgentTask,type SavedPlan} from './plans';
import './agents.css';
import {OutputRequirementsEditor} from './OutputRequirementsEditor';
import {requireOutputCapabilities} from './output-requirements';
import {RunPanel} from './RunPanel';
import {HandoffEditor} from './HandoffEditor';
import {parseRunPolicy} from './runs';

const secureRequest={cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'} as const;

type Ready={handoffRequirementsAvailable:boolean;requirementsAvailable:boolean;schemaAvailable:boolean;usageAvailable:boolean;inputsAvailable:boolean;handoffsAvailable:boolean;runsAvailable:boolean;maxParallel:number;space:string;catalog:AgentChoice[];items:SavedPlan[];next_after:string|null};
function Editor({api,space,catalog,initial,onSave,onDirty,inputsAvailable,requirementsAvailable,schemaAvailable}:{api:ApiClient;space:string;catalog:AgentChoice[];initial:SavedPlan|null;onSave:(plan:SavedPlan)=>void;onDirty:()=>void;inputsAvailable:boolean;requirementsAvailable:boolean;schemaAvailable:boolean}){
 const first=catalog[0];
 const newTask=(id:string):AgentTask=>({task_id:id,agent_id:first?.agent_id??'',model_id:first?.default_model??'',prompt:'',depends_on:[]});
 const [plan,setPlan]=useState<{workflow_id:string;tasks:TaskNode[]}>((initial&&!isHandoffPlan(initial.plan)?initial.plan:null)??{workflow_id:'',tasks:[newTask('task-1')]}),[revision,setRevision]=useState(initial?.revision??0),[issue,setIssue]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[reviewRequired,setReviewRequired]=useState(initial?.configuration_current===false);
 const [taskKeys,setTaskKeys]=useState(()=>plan.tasks.map(()=>crypto.randomUUID()));
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 const update=(index:number,change:TaskNode)=>{
  try{const tasks=replaceTask(plan.tasks,index,change);onDirty();setNotice('');setIssue('');setPlan(value=>({...value,tasks}));}
  catch(error){setIssue(error instanceof Error?error.message:'The task could not be changed.');}
 };
 const save=async()=>{
  if(busy)return;
  setIssue('');setNotice('');
  const controller=new AbortController();active.current=controller;
  try{
   const {workflow_id,tasks}=plan;const valid=validatePlan({...(tasks.some(isInputTask)?{kind:'interactive'}:{}),workflow_id,tasks},catalog);requireOutputCapabilities(valid,requirementsAvailable,schemaAvailable);setBusy(true);
   const result=await api.request<unknown>(planAddress(valid.workflow_id),{...secureRequest,method:'PUT',body:JSON.stringify({expected_revision:revision,plan:valid}),cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
   const saved=parseSavedEdit(result,space,valid,revision);
   if(isHandoffPlan(saved.plan))throw Error('The server returned a different workflow type.');
   if(!controller.signal.aborted){setPlan(saved.plan);setRevision(saved.revision);setReviewRequired(!saved.configuration_current);onSave(saved);setNotice(`Saved revision ${saved.revision}.`);}
  }catch(error){if(!controller.signal.aborted)setIssue(error instanceof ApiError&&error.status===409?'This plan changed. Reload its saved version before editing again. Your draft has been kept.':error instanceof ApiError&&error.status===403?'This key cannot save this plan. Your draft has been kept.':error instanceof Error?error.message:'The save response is unavailable. Reload the saved plan to check whether it was saved.');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 };
 return <form className="agent-editor" onChange={onDirty} onSubmit={event=>{event.preventDefault();void save();}}>
  <h2>{initial?'Edit workflow':'New workflow'}</h2>
  {reviewRequired&&<p className="agent-notice" role="status">The host changed an agent or model configuration. Review every task and save a new revision before running it.</p>}
  <fieldset disabled={busy}>
   <label>Workflow identifier<input required maxLength={128} value={plan.workflow_id} disabled={revision>0} onChange={event=>setPlan(value=>({...value,workflow_id:event.target.value}))}/></label>
   {plan.tasks.map((task,index)=>{
    const agent=isInputTask(task)?undefined:catalog.find(choice=>choice.agent_id===task.agent_id);
    return <section className="agent-task" key={taskKeys[index]} aria-label={`Task ${index+1}`}>
     <div className="agent-task-heading"><h3>Task {index+1}</h3><button type="button" disabled={plan.tasks.length===1} onClick={()=>{onDirty();setTaskKeys(keys=>keys.filter((_,i)=>i!==index));setPlan(value=>({...value,tasks:value.tasks.filter((_,i)=>i!==index).map(other=>({...other,depends_on:other.depends_on.filter(id=>id!==task.task_id)}))}));}}>Remove task {index+1}</button></div>
     {inputsAvailable&&<label>Task type<select aria-label="Task type" value={isInputTask(task)?'input':'model'} onChange={event=>update(index,event.target.value==='input'?{kind:'input',task_id:task.task_id,prompt:task.prompt,depends_on:task.depends_on,max_response_bytes:4000}:{...newTask(task.task_id),prompt:task.prompt,depends_on:task.depends_on})}><option value="model">Model task</option><option value="input">Human input</option></select></label>}
     <div className="agent-fields"><label>Task identifier<input required maxLength={128} value={task.task_id} onChange={event=>update(index,{...task,task_id:event.target.value})}/></label>
      {!isInputTask(task)&&<><label>Agent<select aria-label="Agent" value={task.agent_id} onChange={event=>{const choice=catalog.find(item=>item.agent_id===event.target.value);if(choice)update(index,{...task,agent_id:choice.agent_id,model_id:choice.default_model});}}>
       {!agent&&<option value={task.agent_id}>{task.agent_id||'Choose an agent'} (unavailable)</option>}{catalog.map(choice=><option key={choice.agent_id} value={choice.agent_id}>{choice.agent_id}</option>)}
      </select></label>
      <label>Model<select aria-label="Model" value={task.model_id} onChange={event=>update(index,{...task,model_id:event.target.value})}>
       {!agent?.models.some(model=>model.model_id===task.model_id)&&<option value={task.model_id}>{task.model_id||'Choose a model'} (unavailable)</option>}{agent?.models.map(model=><option key={model.model_id} value={model.model_id}>{model.label} · {model.model_id}</option>)}
      </select></label></>}{isInputTask(task)&&<label>Maximum reply bytes<input type="number" min={1} max={4000} value={task.max_response_bytes} onChange={event=>update(index,{...task,max_response_bytes:Number(event.target.value)})}/></label>}</div>
     <label>{isInputTask(task)?'Question for the user':'Task instructions'}<textarea aria-label={isInputTask(task)?'Question for the user':'Task instructions'} required maxLength={2000} rows={3} value={task.prompt} onChange={event=>update(index,{...task,prompt:event.target.value})}/></label>
     {!isInputTask(task)&&<OutputRequirementsEditor value={task.answer_requirements} available={requirementsAvailable} schemaAvailable={schemaAvailable} onChange={value=>update(index,{...task,answer_requirements:value})}/>}
     <fieldset className="agent-dependencies"><legend>Receive outputs from</legend>{plan.tasks.filter((_,i)=>i!==index).map((other,i)=><label key={i}><input type="checkbox" checked={task.depends_on.includes(other.task_id)} onChange={event=>update(index,{...task,depends_on:event.target.checked?[...task.depends_on,other.task_id]:task.depends_on.filter(id=>id!==other.task_id)})}/>{other.task_id||'Unnamed task'}</label>)}{plan.tasks.length===1&&<p>No other tasks yet.</p>}</fieldset>
    </section>;
   })}
   <div className="agent-actions"><button type="button" disabled={plan.tasks.length>=32||!first} onClick={()=>{onDirty();setTaskKeys(keys=>[...keys,crypto.randomUUID()]);let count=plan.tasks.length+1;while(plan.tasks.some(task=>task.task_id===`task-${count}`))count++;setPlan(value=>({...value,tasks:[...value.tasks,newTask(`task-${count}`)]}));}}>Add task</button><button className="primary" disabled={!first&&!plan.tasks.every(isInputTask)}>{busy?'Saving…':'Save workflow'}</button><span>{revision?`Revision ${revision}`:'Not saved'}</span></div>
  </fieldset>
  {issue&&<p role="alert" className="agent-notice">{issue}</p>}{notice&&<p role="status">{notice}</p>}
 </form>;
}

export function AgentsPage({api,enabled}:{api:ApiClient;enabled:boolean}){
 const [loaded,setLoaded]=useState<{api:ApiClient;data:Ready}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[selection,setSelection]=useState<{id:number;plan:SavedPlan|null;handoff?:boolean}>({id:0,plan:null}),[refresh,setRefresh]=useState(0),[paging,setPaging]=useState(false),[dirty,setDirty]=useState(false);
 const active=useRef<AbortController|null>(null),data=loaded?.api===api?loaded.data:null;
 useEffect(()=>{
  const controller=new AbortController();active.current=controller;setLoaded(null);setError('');setLoading(true);setPaging(false);setDirty(false);setSelection({id:0,plan:null});
  if(!enabled){setLoading(false);return()=>controller.abort();}
  const options={...secureRequest,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])};
  void (async()=>{
   const status=record(await api.request<unknown>('/v1/status',options)),caps=parseCapabilities(await api.request<unknown>('/v1/capabilities',options));
   if(typeof status.space!=='string'||!status.space)throw Error('The connected space could not be verified.');
   if(!caps.features['agents.catalog']||!caps.features['agents.plans'])throw Error('Agent workflow configuration is not enabled on this server.');
   const [catalog,page]=await Promise.all([api.request<unknown>('/v1/agents/catalog',options).then(parseCatalog),api.request<unknown>('/v1/agent-plans?limit=20',options).then(value=>parsePlanPage(value,status.space as string))]);
   const maxParallel=caps.features['agents.parallel']?parseRunPolicy(await api.request<unknown>('/v1/agents/run-policy',options),status.space):1;
   if(!controller.signal.aborted)setLoaded({api,data:{handoffRequirementsAvailable:caps.features['agents.handoffs.output_requirements'],requirementsAvailable:caps.features['agents.output_requirements'],schemaAvailable:caps.features['agents.output_schema'],usageAvailable:caps.features['agents.usage'],inputsAvailable:caps.features['agents.inputs'],handoffsAvailable:caps.features['agents.handoffs'],maxParallel,runsAvailable:caps.features['agents.runs'],space:status.space,catalog,...page}});
  })().catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Agent configuration could not be loaded.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[api,enabled,refresh]);
 const page=async()=>{
  if(!data?.next_after||paging)return;setPaging(true);setError('');const controller=active.current;
  try{
   const result=parsePlanPage(await api.request<unknown>('/v1/agent-plans?limit=20&after='+encodeURIComponent(data.next_after),{...secureRequest,signal:controller?AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)}),data.space);
   if(controller===active.current&&!controller?.signal.aborted)setLoaded(current=>current?.api===api&&current.data.space===data.space?{api,data:{...current.data,items:[...current.data.items,...result.items.filter(item=>!current.data.items.some(prior=>prior.plan.workflow_id===item.plan.workflow_id))],next_after:result.next_after}}:current);
  }catch(error){if(!controller?.signal.aborted)setError(error instanceof Error?error.message:'Could not load more workflows.');}
  finally{if(!controller?.signal.aborted)setPaging(false);}
 };
 const discard=()=>!dirty||window.confirm('Discard your unsaved workflow changes?');
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 return <main id="main" className="agents-page"><header><div className="eyebrow">Agents</div><h1>Workflows and models</h1><p>Choose models for a task workflow or let agents hand off within a plan you define.</p></header>
  {!enabled?<WorkspaceState icon="scopes" title="Connect a memory space" description="Use Memory connection to access saved workflows."/>:loading?<WorkspaceState icon="scopes" title="Loading workflows" description="Checking this host’s agent configuration." busy/>:!data?<WorkspaceState icon="scopes" title="Workflows unavailable" description={error} actions={<button onClick={()=>setRefresh(n=>n+1)}>Try again</button>}/>:<>
   {!data.runsAvailable&&<p className="agent-notice">This server supports saved workflow configuration. Run controls are not enabled.</p>}
   <div className="agents-layout"><aside aria-label="Saved workflows"><h2>Saved in {data.space}</h2><button onClick={()=>{if(discard()){setDirty(false);setSelection(value=>({id:value.id+1,plan:null}));}}}>New workflow</button>{data.handoffsAvailable&&<button onClick={()=>{if(discard()){setDirty(false);setSelection(value=>({id:value.id+1,plan:null,handoff:true}));}}}>New handoff workflow</button>}<ul>{data.items.map(saved=><li key={saved.plan.workflow_id}><button onClick={()=>{if(discard()){setDirty(false);setSelection(value=>({id:value.id+1,plan:saved}));}}}>{saved.plan.workflow_id}<small>Revision {saved.revision} · {isHandoffPlan(saved.plan)?`${saved.plan.agents.length} agents · Handoffs`: `${saved.plan.tasks.length} tasks`}{!saved.configuration_current?' · Review required':''}</small></button></li>)}</ul>{!data.items.length&&<p>No saved workflows yet.</p>}{data.next_after&&<button disabled={paging} onClick={()=>void page()}>{paging?'Loading…':'Load more'}</button>}<button onClick={()=>{if(discard())setRefresh(n=>n+1);}}>Reload saved workflows</button></aside>
   {(()=>{
    const props={api,handoffRequirementsAvailable:data.handoffRequirementsAvailable,requirementsAvailable:data.requirementsAvailable,schemaAvailable:data.schemaAvailable,inputsAvailable:data.inputsAvailable,space:data.space,catalog:data.catalog,initial:selection.plan,onDirty:()=>setDirty(true),onSave:(saved:SavedPlan)=>{setDirty(false);setSelection(current=>({...current,plan:saved}));setLoaded(current=>current?.api===api?{api,data:{...current.data,items:[saved,...current.data.items.filter(item=>item.plan.workflow_id!==saved.plan.workflow_id)]}}:current);}};
    return (selection.plan?isHandoffPlan(selection.plan.plan):selection.handoff)?data.handoffsAvailable?<HandoffEditor key={selection.id} {...props}/>:<p role="alert">This server does not support handoff configuration.</p>:selection.plan&&isInteractivePlan(selection.plan.plan)&&!data.inputsAvailable?<p role="alert">This server does not support human input workflows.</p>:<Editor key={selection.id} {...props}/>;
   })()}</div>{data.runsAvailable&&<RunPanel key={data.space} api={api} space={data.space} plan={selection.plan} dirty={dirty} maxParallel={data.maxParallel} handoffsAvailable={data.handoffsAvailable} inputsAvailable={data.inputsAvailable} usageAvailable={data.usageAvailable}/>} {error&&<p role="alert">{error}</p>}
  </>}
 </main>;
}
