import {useEffect,useRef,useState} from 'react';
import {ApiError,type ApiClient} from '../api';
import type {SavedPlan} from './plans';
import {matchRun,matchSubmission,parseRunPage,parseRunRequest,parseRunResult,parseRunStatus,runAddress,validateStart,type RunSubmission,type RunRequest,type RunStatus,type TaskOutput} from './runs';
const secureRequest={cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'} as const;
function message(error:unknown):string{
 if(error instanceof ApiError){
  if(error.status===403)return 'This key cannot perform that action.';
  if(error.status===404)return 'This run is not available in the connected space. Check the run identifier.';
  if(error.status===409)return 'The run cannot be used in its current state. Its sources, access scope or model configuration may have changed, or execution may be incomplete. No model was restarted.';
  if(error.status===429)return 'The server is busy. Check this run’s status before submitting work again.';
 }
 return error instanceof Error?error.message:'The run response is unavailable.';
}
function RunView({api,space,id,expected,onChanged}:{api:ApiClient;space:string;id:string;expected?:RunSubmission;onChanged:()=>void}){
 const [version,setVersion]=useState(0),[request,setRequest]=useState<RunRequest|null>(null),[status,setStatus]=useState<RunStatus|null>(null),[outputs,setOutputs]=useState<TaskOutput[]|null>(null),[issue,setIssue]=useState(''),[busy,setBusy]=useState(false),[cancelling,setCancelling]=useState(false);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>{
  const controller=new AbortController();active.current=controller;let timer:ReturnType<typeof setTimeout>|undefined;
  const started=Date.now();setRequest(null);setStatus(null);setOutputs(null);setIssue('');setBusy(true);
  const options=()=>({...secureRequest,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
  void (async()=>{
   const original=parseRunRequest(await api.request<unknown>(runAddress(id)+'/request',options()),space,id);
   if(expected)matchSubmission(original,expected);
   if(controller.signal.aborted)return;setRequest(original);
   const poll=async():Promise<void>=>{
    try{
     const progress=parseRunStatus(await api.request<unknown>(runAddress(id),options()),space,id);matchRun(progress,original);
     if(controller.signal.aborted)return;setStatus(progress);setOutputs(null);setIssue('');
     if(!progress.active_local&&['completed','verification_unavailable'].includes(progress.status)){
      const verified=parseRunResult(await api.request<unknown>(runAddress(id)+'/result',options()),original);
      if(!controller.signal.aborted)setOutputs(verified.tasks);
     }else if((progress.active_local||progress.status==='running')&&!progress.outcome_unknown){
      if(Date.now()-started<330000)timer=setTimeout(()=>void poll(),1500);
      else setIssue('Automatic status checks paused. Use Check status to continue.');
     }
    }catch(error){if(!controller.signal.aborted){setOutputs(null);setIssue(message(error));}}
    finally{if(!controller.signal.aborted)setBusy(false);}
   };
   await poll();
  })().catch(error=>{if(!controller.signal.aborted){setIssue(message(error));setBusy(false);}});
  return()=>{controller.abort();if(timer)clearTimeout(timer);};
 },[api,space,id,version,expected]);
 const cancel=async()=>{
  if(cancelling||!status?.active_local)return;
  const controller=active.current;if(!controller)return;setCancelling(true);setOutputs(null);setIssue('');
  try{
   const result=parseRunStatus(await api.request<unknown>(runAddress(id)+'/cancel',{...secureRequest,method:'POST',body:'{}',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),space,id);
   if(request)matchRun(result,request);
   if(!controller.signal.aborted){setStatus(result);setCancelling(false);setVersion(n=>n+1);onChanged();}
  }catch(error){if(!controller.signal.aborted)setIssue(message(error)+' Cancellation is not confirmed; check this same run before taking another action.');}
  finally{if(!controller.signal.aborted)setCancelling(false);}
 };
 return <section className="agent-run-view" aria-label="Selected run"><h3>Run {id}</h3>
  <div className="agent-actions"><button disabled={busy||cancelling} onClick={()=>setVersion(n=>n+1)}>{busy?'Checking…':'Check status'}</button>{status?.active_local&&<button disabled={cancelling} onClick={()=>void cancel()}>{cancelling?'Cancelling…':'Cancel run'}</button>}</div>
  {status&&<p role="status">{status.status} · {status.completed_steps.length} tasks completed{status.inflight?` · Working on ${status.inflight}`:''}{status.active_local?' · Active on this server':''}</p>}
  {status?.outcome_unknown&&<p className="agent-notice">A model call was interrupted and its outcome is unknown. This run will not be replayed. A new run is a separate execution.</p>}
  {status?.error_class&&<p>Run detail: {status.error_class}</p>}
  {request&&<details open><summary>Original request · {request.plan.workflow_id} · Revision {request.revision}</summary><p className="agent-output">{request.question}</p><ul>{request.plan.tasks.map(task=><li key={task.task_id}>{task.task_id}: {task.agent_id} · {task.model_id}{task.depends_on.length?` · Receives ${task.depends_on.join(', ')}`:''}</li>)}</ul></details>}
  {outputs&&<div aria-label="Verified run results">{outputs.map(output=><article key={output.task_id}><h4>{output.task_id} · {output.model_id}</h4><p>{output.source_status==='retained'?`${output.evidence_ids.length} retained evidence references`:'No retained evidence · Treat this as ungrounded model output'} · {output.model_calls} model calls · {output.tool_calls} tool calls</p><div className="agent-output">{output.text}</div></article>)}</div>}
  {issue&&<p role="alert" className="agent-notice">{issue}</p>}
 </section>;
}
function RunHistory({api,space,version,onSelect}:{api:ApiClient;space:string;version:number;onSelect:(id:string)=>void}){
 const [items,setItems]=useState<RunStatus[]>([]),[after,setAfter]=useState<string|null>(null),[busy,setBusy]=useState(false),[issue,setIssue]=useState('');
 const active=useRef<AbortController|null>(null);
 const load=async(controller:AbortController,cursor:string|null)=>{
  setBusy(true);setIssue('');
  try{
   const page=parseRunPage(await api.request<unknown>('/v1/agent-runs?limit=20'+(cursor?'&after='+encodeURIComponent(cursor):''),{...secureRequest,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),space);
   if(!controller.signal.aborted){setItems(current=>cursor?[...current,...page.items.filter(item=>!current.some(prior=>prior.run_id===item.run_id))]:page.items);setAfter(page.next_after);}
  }catch(error){if(!controller.signal.aborted)setIssue(message(error));}
  finally{if(!controller.signal.aborted)setBusy(false);}
 };
 useEffect(()=>{const controller=new AbortController();active.current=controller;setItems([]);setAfter(null);void load(controller,null);return()=>controller.abort();},[api,space,version]);
 return <section aria-label="Run history"><h3>Run history in {space}</h3><ul className="agent-run-list">{items.map(run=><li key={run.run_id}><button onClick={()=>onSelect(run.run_id)}>{run.run_id} · {run.workflow_id}<small>{run.status} · Revision {run.plan_revision}</small></button></li>)}</ul>{!busy&&!items.length&&!issue&&<p>No runs saved yet.</p>}{busy&&<p role="status">Loading runs…</p>}{after&&<button disabled={busy} onClick={()=>{if(active.current)void load(active.current,after);}}>Load more runs</button>}{issue&&<p role="alert">{issue}</p>}</section>;
}
export function RunPanel({api,space,plan,dirty}:{api:ApiClient;space:string;plan:SavedPlan|null;dirty:boolean}){
 const [runId,setRunId]=useState<string>(()=>crypto.randomUUID()),[question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false),[issue,setIssue]=useState(''),[submitted,setSubmitted]=useState<RunSubmission|null>(null),[selected,setSelected]=useState<{id:string;version:number;expected?:RunSubmission}|null>(null),[history,setHistory]=useState(0),[lookup,setLookup]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 const inspect=(id:string,expected?:RunSubmission)=>{runAddress(id);setSelected(current=>({id,expected:expected??(submitted?.run_id===id?submitted:undefined),version:(current?.version??0)+1}));};
 const start=async()=>{
  if(!plan||dirty||!plan.configuration_current||busy||attempted)return;
  setIssue('');const controller=new AbortController();active.current=controller;
  try{
   const payload=validateStart(runId,plan.plan.workflow_id,plan.revision,question);const expected:RunSubmission={space,run_id:runId,question,revision:plan.revision,plan:plan.plan,bindings:plan.bindings};setSubmitted(expected);setBusy(true);setAttempted(true);
   const status=parseRunStatus(await api.request<unknown>('/v1/agent-runs',{...secureRequest,method:'POST',body:JSON.stringify(payload),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),space,runId);
   if(status.workflow_id!==payload.workflow_id||status.plan_revision!==payload.plan_revision)throw Error('The admitted run does not match this saved workflow revision.');
   if(!controller.signal.aborted){inspect(runId,expected);setHistory(n=>n+1);}
  }catch(error){if(!controller.signal.aborted)setIssue(message(error)+' Check this run identifier before starting another execution.');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 };
 return <section className="agent-runs" aria-label="Workflow runs"><h2>Run a workflow</h2><p>{plan?`Selected: ${plan.plan.workflow_id} · Revision ${plan.revision}`:'Select or save a workflow to run it.'}</p>
  {dirty&&<p className="agent-notice">Save your workflow changes before starting a run.</p>}
  <form onSubmit={event=>{event.preventDefault();void start();}}><fieldset disabled={busy||attempted}><label>Run identifier<input value={runId} maxLength={128} required onChange={event=>setRunId(event.target.value)}/></label><label>Question<textarea value={question} rows={3} maxLength={4000} required onChange={event=>setQuestion(event.target.value)}/></label><button className="primary" disabled={!plan||dirty||!plan.configuration_current}>{busy?'Starting…':'Start run'}</button></fieldset></form>
  {attempted&&<div className="agent-actions"><button disabled={busy} onClick={()=>inspect(runId)}>Check submitted run</button><button disabled={busy} onClick={()=>{setRunId(crypto.randomUUID());setAttempted(false);setIssue('');}}>Prepare a new run</button><span>A new run calls the selected models again.</span></div>}
  {issue&&<p role="alert" className="agent-notice">{issue}</p>}
  <form className="agent-run-lookup" onSubmit={event=>{event.preventDefault();try{inspect(lookup);setIssue('');}catch(error){setIssue(message(error));}}}><label>Find run by identifier<input value={lookup} maxLength={128} required onChange={event=>setLookup(event.target.value)}/></label><button>Open run</button></form>
  {selected&&<RunView key={`${selected.id}:${selected.version}`} api={api} space={space} id={selected.id} expected={selected.expected} onChanged={()=>setHistory(n=>n+1)}/>}
  <RunHistory api={api} space={space} version={history} onSelect={inspect}/>
 </section>;
}
